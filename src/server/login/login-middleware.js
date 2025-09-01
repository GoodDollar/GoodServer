// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Strategy as AnonymousStrategy } from 'passport-anonymous'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import { defaults } from 'lodash'
import { PublicKey } from '@textile/crypto'
import { TextEncoder } from 'util'
import isBase64 from 'is-base64'
import { sha3 } from 'web3-utils'
import { AxelarQueryAPI } from '@axelar-network/axelarjs-sdk'
import * as ethers from 'ethers'

import logger from '../../imports/logger'
import { wrapAsync } from '../utils/helpers'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import Config from '../server.config.js'
import { recoverPublickey, verifyIdentifier } from '../utils/eth'
import { strcasecmp } from '../utils/string'
import requestRateLimiter from '../utils/requestRateLimiter'
import clientSettings from '../clients.config.js'

const log = logger.child({ from: 'login-middleware' })

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: Config.jwtPassword
}

const MSG = 'Login to GoodDAPP'
const FV_LOGIN_MSG = `Sign this message to login into GoodDollar Unique Identity service.
WARNING: do not sign this message unless you trust the website/application requesting this signature.
nonce:`

const FV_IDENTIFIER_MSG = `Sign this message to create your own unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`

const isProfileSignatureCompatible = (signature, nonce) => {
  if (isBase64(signature)) {
    return true
  }

  if (signature.startsWith('SEA')) {
    let json

    try {
      json = JSON.parse(signature.replace(/^SEA/, ''))
    } catch {
      json = null
    }

    if (json && json.m === `Login to GoodDAPP${nonce}`) {
      return false
    }
  }

  throw new Error('Invalid profile signature received. Should be a valid BASE64 string.')
}

const verifyProfilePublicKey = async (publicKeyString, signature, nonce) => {
  try {
    const profilePublicKey = PublicKey.fromString(publicKeyString)
    const sigbytes = Uint8Array.from(Buffer.from(signature, 'base64'))
    const msgbytes = new TextEncoder().encode(MSG + nonce)

    return await profilePublicKey.verify(msgbytes, sigbytes)
  } catch (e) {
    log.warn('Error verifying profile public key', e.message, e, { publicKeyString, signature, nonce })
    return false
  }
}

export const strategy = new Strategy(jwtOptions, async (jwtPayload, next) => {
  const { loggedInAs: identifier, exp } = jwtPayload
  let user = false

  const isExpired = Date.now() / 1000 > Number(exp)
  log.trace('jwt expiration check:', { isExpired, exp, jwtPayload })
  if (identifier && !isExpired) {
    user = await UserDBPrivate.getUser(identifier) // usually this would be a database call

    log.trace('payload received', { jwtPayload, user })
    // if user is empty make sure we have something
    user = defaults(jwtPayload, user, { identifier })
  }

  next(null, user)
})

const generateJWT = async (recovered, identifier = null, payload = {}) => {
  const { env, jwtPassword, jwtExpiration } = Config
  const userId = identifier || sha3(recovered)
  const userRecord = await UserDBPrivate.getUser(userId)
  const { smsValidated, isEmailConfirmed, createdDate } = userRecord || {}
  const hasVerified = smsValidated || isEmailConfirmed
  const hasSignedUp = !!createdDate

  if (hasSignedUp && !hasVerified) {
    const logPayload = { recovered }

    if (userId !== recovered) {
      logPayload.identifier = userId
    }

    log.warn('user doesnt have email nor mobile verified', logPayload)
  }

  log.info(`SigUtil Successfully verified signer as ${recovered}`, { hasSignedUp })

  const token = jwt.sign(
    {
      loggedInAs: userId,
      gdAddress: recovered,
      profilePublickey: recovered,
      exp: Math.floor(Date.now() / 1000) + (hasSignedUp ? jwtExpiration : 3600), //if not signed up jwt will last only 60 seconds so it will be refreshed after signup
      aud: hasSignedUp || hasVerified ? `realmdb_wallet_${env}` : 'unsigned',
      sub: recovered,
      ...payload
    },
    jwtPassword
  )

  UserDBPrivate.updateUser({ identifier: userId, lastLogin: new Date() })
  return token
}

const setup = (app: Router) => {
  passport.use(strategy)
  passport.use(new AnonymousStrategy())
  app.use(passport.initialize())

  /**
   * @api {post} /auth/eth Request user token
   * @apiName eth
   * @apiGroup Login
   *
   * @apiParam {String} signature
   * @apiParam {String} gdSignature
   * @apiParam {String} profilePublickey
   * @apiParam {String} profileSignature
   * @apiParam {String} nonce
   * @apiParam {String} method
   *
   * @apiSuccess {String} token
   * @ignore
   */
  app.post(
    '/auth/eth',
    wrapAsync(async (req, res) => {
      const { log, body } = req

      log.debug('/auth/eth', { message: 'authorizing' })
      log.debug('/auth/eth', { body })

      const { nonce, method, signature, gdSignature, profileSignature, profilePublickey: profileReqPublickey } = body

      log.debug('/auth/eth', { signature, method })

      // if (networkId !== configNetworkId) {
      //   log.warn('/auth/eth', {
      //     message: 'Networkd id mismatch',
      //     client: networkId,
      //     server: configNetworkId
      //   })

      //   throw new Error(`Network ID mismatch client: ${networkId} ours: ${configNetworkId}`)
      // }

      const recovered = recoverPublickey(signature, MSG, nonce)
      const gdPublicAddress = recoverPublickey(gdSignature, MSG, nonce)
      let profileVerified = true

      // ignore profile signature check if public key is null or signature was sent from the old wallet version using GUN
      if (profileReqPublickey != null && isProfileSignatureCompatible(profileSignature, nonce) === true) {
        profileVerified = await verifyProfilePublicKey(profileReqPublickey, profileSignature, nonce)
      }

      log.debug('/auth/eth', {
        message: 'Recovered public key',
        recovered,
        gdPublicAddress,
        profileVerified,
        profileReqPublickey
      })

      if (!recovered || !gdPublicAddress || !profileVerified) {
        log.warn('/auth/eth', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }

      const token = await generateJWT(recovered, recovered, {
        method,
        gdAddress: gdPublicAddress,
        profilePublickey: profileReqPublickey
      })

      log.info('/auth/eth', {
        message: `JWT token: ${token}`
      })

      res.json({ token })
    })
  )

  app.post(
    '/auth/fv',
    wrapAsync(async (req, res) => {
      const { log, body } = req

      log.debug('/auth/fv', { message: 'authorizing' })
      log.debug('/auth/fv', { body })

      const { nonce, signature, fvsig } = body

      log.debug('/auth/fv', { signature, nonce, fvsig })

      const seconds = parseInt((Date.now() / 1000).toFixed(0))

      if (parseInt(nonce) + 300 < seconds) {
        throw new Error('invalid nonce for fv login')
      }

      const recovered = recoverPublickey(signature, FV_LOGIN_MSG, nonce)
      const fvrecovered = recoverPublickey(fvsig, FV_IDENTIFIER_MSG, '')

      log.debug('/auth/fv', {
        message: 'Recovered public key',
        recovered,
        fvrecovered
      })

      if (!recovered || strcasecmp(recovered, fvrecovered)) {
        log.warn('/auth/fv', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }

      const token = await generateJWT(recovered)

      log.info('/auth/fv', {
        message: `JWT token: ${token}`
      })

      res.json({ token })
    })
  )

  app.post(
    '/auth/fv2',
    wrapAsync(async (req, res) => {
      const { log, body } = req

      log.debug('/auth/fv2', { message: 'authorizing' })
      log.debug('/auth/fv2', { body })

      const { fvsig, account, chainId = '42220' } = body

      log.debug('/auth/fv2', { account, fvsig })

      try {
        await verifyIdentifier(fvsig, account, chainId)
        const token = await generateJWT(account)

        log.info('/auth/fv2', {
          message: `JWT token: ${token}`
        })

        res.json({ token })
      } catch (e) {
        log.error('/auth/fv2 failed', e.message, e, { account, fvsig })
        throw e
      }
    })
  )

  app.get(
    '/auth/ping',
    requestRateLimiter(10),
    wrapAsync(async (req, res) => {
      res.json({ ping: new Date() })
    })
  )

  app.post(
    '/auth/settings',
    requestRateLimiter(10),
    wrapAsync(async (req, res) => {
      const env = req.body.env
      const settings = clientSettings[env] || { fromServer: false }
      res.json(settings)
    })
  )

  app.get(
    '/auth/test',
    passport.authenticate('jwt', { session: false }),
    wrapAsync((req, res) => {
      const log = req.log

      log.debug('/auth/test', req.user)

      res.end()
    })
  )

  app.get(
    '/bridge/estimatefees',
    requestRateLimiter(10),
    wrapAsync(async (req, res) => {
      const axlApi = new AxelarQueryAPI({ environment: 'mainnet' })
      const [axlCeloEth, axlEthCelo] = await Promise.all([
        axlApi.estimateGasFee('Celo', 'Ethereum', 'Celo', '300000', 1.1).then(_ => _ / 1e18),
        axlApi.estimateGasFee('Ethereum', 'Celo', 'ETH', '300000', 1.1).then(_ => _ / 1e18)
      ])
      const bridge = new ethers.Contract('0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5', [
        'function estimateSendFee(uint16,address,address,uint256,bool,bytes) view returns (uint256,uint256)'
      ])

      const fuseProvider = new ethers.providers.JsonRpcProvider(Config['fuse'].httpWeb3Provider.split(',')[0])
      const celoProvider = new ethers.providers.JsonRpcProvider(Config['celo'].httpWeb3Provider.split(',')[0])

      const bridgeEth = bridge.connect(
        new ethers.providers.JsonRpcProvider(Config['ethereumMainnet'].httpWeb3Provider.split(',')[0])
      )
      const bridgeFuse = bridge.connect(fuseProvider)
      const bridgeCelo = bridge.connect(celoProvider)
      const bridgeXdc = bridge.connect(
        new ethers.providers.JsonRpcProvider(Config['xdc'].httpWeb3Provider.split(',')[0])
      )

      const params = ethers.utils.solidityPack(['uint16', 'uint256'], [1, 400000])
      // Define chain info
      const chains = [
        { name: 'ETH', id: 101, provider: bridgeEth, symbol: 'ETH' },
        { name: 'FUSE', id: 138, provider: bridgeFuse, symbol: 'Fuse' },
        { name: 'CELO', id: 125, provider: bridgeCelo, symbol: 'Celo' },
        { name: 'XDC', id: 365, provider: bridgeXdc, symbol: 'XDC' }
      ]

      // Calculate all pairs except same-chain
      const lzFees = {}
      const feePromises = []

      for (let from of chains) {
        for (let to of chains) {
          if (from.name === to.name) continue
          const key = `LZ_${from.name}_TO_${to.name}`
          // Estimate send fee
          const promise = from.provider
            .estimateSendFee(to.id, ethers.constants.AddressZero, ethers.constants.AddressZero, 0, false, params)
            .then(_ => {
              // _[0] is the fee BigNumber
              lzFees[key] = _.length > 0 ? _[0].toString() / 1e18 + ' ' + from.symbol : null
            })
            .catch(() => {
              lzFees[key] = null
            })
          feePromises.push(promise)
        }
      }

      await Promise.all(feePromises)
      res.json({
        AXELAR: { AXL_CELO_TO_ETH: axlCeloEth + ' Celo', AXL_ETH_TO_CELO: axlEthCelo + ' ETH' },
        LAYERZERO: lzFees
      })
    })
  )

  log.info('Done setup login middleware.')
}

export default setup

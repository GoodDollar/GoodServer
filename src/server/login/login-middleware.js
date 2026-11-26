// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Strategy as AnonymousStrategy } from 'passport-anonymous'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { Router } from 'express'
import { defaults } from 'lodash'
import { AxelarQueryAPI } from '@axelar-network/axelarjs-sdk'
import { BigNumber } from 'ethers'
import { encodePacked, formatEther } from 'viem'

import logger from '../../imports/logger'
import { wrapAsync } from '../utils/helpers'
import { sanitizeLog } from '../utils/sanitizeLog'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import MultiWallet from '../blockchain/MultiWallet'
import Config from '../server.config.js'
import { hashString, recoverPublickey, verifyIdentifier } from '../utils/eth'
import { strcasecmp } from '../utils/string'
import requestRateLimiter from '../utils/requestRateLimiter'
import clientSettings from '../clients.config.js'
import estimateAxelarFees from './estimateAxelarFees'

const log = logger.child({ from: 'login-middleware' })
const LAYERZERO_BRIDGE_ADDRESS = '0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5'
const ESTIMATE_SEND_FEE_ABI = [
  {
    inputs: [
      { name: '_dstChainId', type: 'uint16' },
      { name: '_refundAddress', type: 'address' },
      { name: '_toAddress', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_useZro', type: 'bool' },
      { name: '_adapterParams', type: 'bytes' }
    ],
    name: 'estimateSendFee',
    outputs: [
      { name: '_nativeFee', type: 'uint256' },
      { name: '_zroFee', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]
const L1_FEE_ORACLE_ABI = [
  {
    inputs: [{ name: 'executeData', type: 'bytes' }],
    name: 'getL1Fee',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
]

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
  const userId = identifier || hashString(recovered)
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

const getWalletPublicClient = chainId => {
  const { mainWallet, walletsMap } = MultiWallet
  const client =
    Number(chainId) === Number(mainWallet.networkIdMainnet)
      ? mainWallet.mainnetPublicClient
      : walletsMap[chainId]?.publicClient

  if (!client) {
    log.error(`Public client for chain ${chainId} is unavailable`, {
      mainWalletChainId: mainWallet.networkIdMainnet,
      mainWalletClient: mainWallet.mainnetPublicClient
    })
    throw new Error(`Public client for chain ${chainId} is unavailable`)
  }

  return client
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
   * @apiParam {String} nonce
   * @apiParam {String} method
   *
   * @apiSuccess {String} token
   * @ignore
   */
  app.post(
    '/auth/eth',
    requestRateLimiter(30, 1),
    wrapAsync(async (req, res) => {
      const { log, body } = req

      log.debug('/auth/eth', { message: 'authorizing' })
      log.debug('/auth/eth', { body })

      const { nonce, method, signature, gdSignature } = body

      log.debug('/auth/eth', { signature, method })

      // if (networkId !== configNetworkId) {
      //   log.warn('/auth/eth', {
      //     message: 'Networkd id mismatch',
      //     client: networkId,
      //     server: configNetworkId
      //   })

      //   throw new Error(`Network ID mismatch client: ${networkId} ours: ${configNetworkId}`)
      // }

      const recovered = await recoverPublickey(signature, MSG, nonce)
      const gdPublicAddress = await recoverPublickey(gdSignature, MSG, nonce)

      log.debug('/auth/eth', {
        message: 'Recovered public key',
        recovered,
        gdPublicAddress
      })

      if (!recovered || !gdPublicAddress) {
        log.warn('/auth/eth', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }

      const token = await generateJWT(recovered, recovered, {
        method,
        gdAddress: gdPublicAddress
      })

      log.info('/auth/eth', {
        message: `JWT token: ${token}`
      })

      res.json({ token })
    })
  )

  app.post(
    '/auth/fv',
    requestRateLimiter(30, 1),
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

      const recovered = await recoverPublickey(signature, FV_LOGIN_MSG, nonce)
      const fvrecovered = await recoverPublickey(fvsig, FV_IDENTIFIER_MSG, '')

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
    requestRateLimiter(30, 1),
    wrapAsync(async (req, res) => {
      const { log, body } = req

      log.debug('/auth/fv2', { message: 'authorizing' })
      log.debug('/auth/fv2', { body })

      const { fvsig, account, chainId = '42220' } = body

      log.debug('/auth/fv2', { account, fvsig, chainId })

      try {
        await verifyIdentifier(fvsig, account, chainId)
        const token = await generateJWT(account)

        log.info('/auth/fv2', {
          message: `JWT token: ${token}`
        })

        res.json({ token })
      } catch (e) {
        log.error('/auth/fv2 failed', sanitizeLog(e.message), e, {
          account: sanitizeLog(account),
          fvsig: sanitizeLog(fvsig)
        })
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
      await MultiWallet.ready
      const ethClient = getWalletPublicClient(1)
      const fuseClient = getWalletPublicClient(122)
      const celoClient = getWalletPublicClient(42220)
      const xdcClient = getWalletPublicClient(50)
      const axlApi = new AxelarQueryAPI({ environment: 'mainnet' })
      axlApi.estimateL1GasFee = async (chain, params) => {
        if (params.l2Type !== 'op') return BigNumber.from(0)

        const client = chain === 'celo' ? celoClient : ethClient
        const fee = await client.readContract({
          address: params.l1GasOracleAddress || '0x420000000000000000000000000000000000000F',
          abi: L1_FEE_ORACLE_ABI,
          functionName: 'getL1Fee',
          args: [params.executeData]
        })

        return BigNumber.from(fee)
      }
      const { axlCeloEth, axlEthCelo } = await estimateAxelarFees(axlApi)
      const params = encodePacked(['uint16', 'uint256'], [1, 400000n])
      // Define chain info
      const chains = [
        { name: 'ETH', id: 101, provider: ethClient, symbol: 'ETH' },
        { name: 'FUSE', id: 138, provider: fuseClient, symbol: 'Fuse' },
        { name: 'CELO', id: 125, provider: celoClient, symbol: 'Celo' },
        { name: 'XDC', id: 365, provider: xdcClient, symbol: 'XDC' }
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
            .readContract({
              address: LAYERZERO_BRIDGE_ADDRESS,
              abi: ESTIMATE_SEND_FEE_ABI,
              functionName: 'estimateSendFee',
              args: [
                to.id,
                '0x0000000000000000000000000000000000000000',
                '0x0000000000000000000000000000000000000000',
                0n,
                false,
                params
              ]
            })
            .then(fees => {
              lzFees[key] = Array.isArray(fees) && fees.length > 0 ? `${formatEther(fees[0])} ${from.symbol}` : null
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

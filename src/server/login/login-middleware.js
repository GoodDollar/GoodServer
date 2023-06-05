// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Strategy as AnonymousStrategy } from 'passport-anonymous'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import { defaults } from 'lodash'
import * as Crypto from '@textile/crypto'
import { TextEncoder } from 'util'
import isBase64 from 'is-base64'
import { sha3 } from 'web3-utils'

import logger from '../../imports/logger'
import { wrapAsync } from '../utils/helpers'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import Config from '../server.config.js'
import { recoverPublickey } from '../utils/eth'
import { mustache, strcasecmp } from '../utils/string'
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

export const FV_IDENTIFIER_MSG2 = mustache(`Sign this message to request verifying your account {account} and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`)

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
    const profilePublicKey = Crypto.PublicKey.fromString(publicKeyString)
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

      const { fvsig, account } = body

      log.debug('/auth/fv2', { account, fvsig })

      const recovered = recoverPublickey(fvsig, FV_IDENTIFIER_MSG2({ account }), '')

      log.debug('/auth/fv2', {
        message: 'Recovered public key',
        recovered
      })

      // strcasemp returns non-zero if not match
      if (strcasecmp(recovered, account)) {
        log.warn('/auth/f2v', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }

      const token = await generateJWT(recovered)

      log.info('/auth/fv2', {
        message: `JWT token: ${token}`
      })

      res.json({ token })
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

  log.info('Done setup login middleware.')
}

export default setup

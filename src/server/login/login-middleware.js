// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
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

const FV_IDENTIFIER_MSG = `Sign this message to create your own unique identifier for you anonymized record.
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
  const { loggedInAs: identifier } = jwtPayload
  let user = false

  if (identifier) {
    user = await UserDBPrivate.getUser(identifier) // usually this would be a database call

    log.debug('payload received', { jwtPayload, user })
    // if user is empty make sure we have something
    user = defaults(jwtPayload, user, { identifier })
  }

  next(null, user)
})

const setup = (app: Router) => {
  passport.use(strategy)

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
      const { network_id: configNetworkId } = Config.ethereum

      log.debug('/auth/eth', { message: 'authorizing' })
      log.debug('/auth/eth', { body })

      const {
        nonce,
        method,
        networkId,
        signature,
        gdSignature,
        profileSignature,
        profilePublickey: profileReqPublickey
      } = body

      log.debug('/auth/eth', { signature, method })

      if (networkId !== configNetworkId) {
        log.warn('/auth/eth', {
          message: 'Networkd id mismatch',
          client: networkId,
          server: configNetworkId
        })

        throw new Error(`Network ID mismatch client: ${networkId} ours: ${configNetworkId}`)
      }

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

      if (recovered && gdPublicAddress && profileVerified) {
        const userRecord = await UserDBPrivate.getUser(recovered)
        const hasVerified = userRecord && (userRecord.smsValidated || userRecord.isEmailConfirmed)
        const hasSignedUp = userRecord && userRecord.createdDate

        if (hasSignedUp && !hasVerified) {
          log.warn('user doesnt have email nor mobile verified', { recovered })
        }

        log.info(`SigUtil Successfully verified signer as ${recovered}`, { hasSignedUp })

        const token = jwt.sign(
          {
            method: method,
            loggedInAs: recovered,
            gdAddress: gdPublicAddress,
            profilePublickey: profileReqPublickey,
            exp: Math.floor(Date.now() / 1000) + (hasSignedUp ? Config.jwtExpiration : 3600), //if not signed up jwt will last only 60 seconds so it will be refreshed after signup
            aud: hasSignedUp || hasVerified ? `realmdb_wallet_${Config.env}` : 'unsigned',
            sub: recovered
          },
          Config.jwtPassword
        )

        UserDBPrivate.updateUser({ identifier: recovered, lastLogin: new Date() })

        log.info('/auth/eth', {
          message: `JWT token: ${token}`
        })

        res.json({ token })
        res.end()
      } else {
        log.warn('/auth/eth', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }
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

      if (recovered && recovered === fvrecovered) {
        const identifier = sha3(recovered)
        const userRecord = await UserDBPrivate.getUser(identifier)
        const hasVerified = userRecord && (userRecord.smsValidated || userRecord.isEmailConfirmed)
        const hasSignedUp = userRecord && userRecord.createdDate

        if (hasSignedUp && !hasVerified) {
          log.warn('user doesnt have email nor mobile verified', { recovered, identifier })
        }

        log.info(`SigUtil Successfully verified signer as ${recovered}`, { hasSignedUp })

        const token = jwt.sign(
          {
            loggedInAs: identifier,
            gdAddress: recovered,
            profilePublickey: recovered,
            exp: Math.floor(Date.now() / 1000) + (hasSignedUp ? Config.jwtExpiration : 3600), //if not signed up jwt will last only 60 seconds so it will be refreshed after signup
            aud: hasSignedUp || hasVerified ? `realmdb_wallet_${Config.env}` : 'unsigned',
            sub: recovered
          },
          Config.jwtPassword
        )

        UserDBPrivate.updateUser({ identifier, lastLogin: new Date() })

        log.info('/auth/fv', {
          message: `JWT token: ${token}`
        })

        res.json({ token })
        res.end()
      } else {
        log.warn('/auth/fv', {
          message: 'SigUtil unable to recover the message signer'
        })

        throw new Error('Unable to verify credentials')
      }
    })
  )

  app.get(
    '/auth/ping',
    requestRateLimiter(200),
    wrapAsync(async (req, res) => {
      res.json({ ping: new Date() })
    })
  )

  app.post(
    '/auth/settings',
    requestRateLimiter(200),
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

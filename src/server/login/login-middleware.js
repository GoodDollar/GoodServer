// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import { defaults } from 'lodash'
import moment from 'moment'
import logger from '../../imports/logger'
import { wrapAsync } from '../utils/helpers'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import SEA from '@gooddollar/gun/sea'
import Config from '../server.config.js'
import { recoverPublickey } from '../utils/eth'
import requestRateLimiter from '../utils/requestRateLimiter'
import clientSettings from '../clients.config.js'
import { GunDBPublic } from '../gun/gun-middleware'
import { sha3 } from 'web3-utils'
const log = logger.child({ from: 'login-middleware' })

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: Config.jwtPassword
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

//for user registered before we fixed database persistance we need to
//add them again to the trust indexes
const fixTrustIndex = async (identifier, gdAddress, logger) => {
  const user = await UserDBPrivate.getUser(identifier)
  if (user && (!user.trustIndex || moment(user.trustIndex).isBefore(moment().subtract(1, 'day')))) {
    await Promise.all([
      user.smsValidated &&
        user.mobile &&
        user.mobile.startsWith('0x') &&
        GunDBPublic.addHashToIndex('mobile', user.mobile, user),
      user.email &&
        user.isEmailConfirmed &&
        user.email.startsWith('0x') &&
        GunDBPublic.addHashToIndex('email', user.email, user),

      gdAddress && GunDBPublic.addUserToIndex('walletAddress', gdAddress.toLowerCase(), user),
      UserDBPrivate.model.updateOne(
        { identifier: user.identifier },
        { trustIndex: Date.now(), walletAddress: sha3(gdAddress.toLowerCase()) }
      )
    ])
    logger.info('fixed trust index for user:', { identifier, gdAddress, mobile: user.mobile, email: user.email })
  }
}

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
      const log = req.log

      log.debug('/auth/eth', { message: 'authorizing' })
      log.debug('/auth/eth', { body: req.body })

      const signature = req.body.signature
      const gdSignature = req.body.gdSignature
      const profileReqPublickey = req.body.profilePublickey
      const profileSignature = req.body.profileSignature
      const nonce = req.body.nonce
      const method = req.body.method
      const networkId = req.body.networkId

      if (networkId !== Config.ethereum.network_id) {
        log.warn('/auth/eth', {
          message: 'Networkd id mismatch',
          client: networkId,
          server: Config.ethereum.network_id
        })
        throw new Error(`Network ID mismatch client: ${networkId} ours: ${Config.ethereum.network_id}`)
      }
      log.debug('/auth/eth', { signature, method })

      const msg = 'Login to GoodDAPP'
      const recovered = recoverPublickey(signature, msg, nonce)
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      const profileVerified =
        profileReqPublickey != null ? (await SEA.verify(profileSignature, profileReqPublickey)) === msg + nonce : true
      log.debug('/auth/eth', {
        message: 'Recovered public key',
        recovered,
        gdPublicAddress,
        profileVerified,
        profileReqPublickey
      })

      if (recovered && gdPublicAddress && profileVerified) {
        log.info(`SigUtil Successfully verified signer as ${recovered}`)
        const userRecord = await UserDBPrivate.getUser(recovered)
        const hasSignedUp = userRecord && (userRecord.smsValidated || userRecord.isEmailConfirmed)
        const token = jwt.sign(
          {
            method: method,
            loggedInAs: recovered,
            gdAddress: gdPublicAddress,
            profilePublickey: profileReqPublickey,
            exp: Math.floor(Date.now() / 1000) + (hasSignedUp ? Config.jwtExpiration : 60), //if not signed up jwt will last only 60 seconds so it will be refreshed after signup
            aud: hasSignedUp ? `realmdb_wallet_${Config.env}` : 'unsigned',
            sub: recovered
          },
          Config.jwtPassword
        )

        fixTrustIndex(recovered, gdPublicAddress, log)

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

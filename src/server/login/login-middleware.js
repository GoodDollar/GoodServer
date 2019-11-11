// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import SEA from 'gun/sea'
import Config from '../server.config.js'
import { recoverPublickey } from '../utils/eth'
import requestRateLimiter from '../utils/requestRateLimiter'

// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy

const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = Config.jwtPassword
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
export const strategy = new Strategy(jwtOptions, async (jwtPayload, next) => {
  const log = logger.child({ from: 'login-middleware' })
  // usually this would be a database call:
  let user = await UserDBPrivate.getUser(jwtPayload.loggedInAs)
  log.debug('payload received', { jwtPayload, user })
  //if user is empty make sure we have something
  user = defaults(user, jwtPayload, { identifier: jwtPayload.loggedInAs })
  if (get(jwtPayload, 'loggedInAs')) {
    next(null, user)
  } else {
    next(null, false)
  }
})

const setup = (app: Router) => {
  passport.use(strategy)

  app.use(passport.initialize())

  app.use(
    ['/user/*'],
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, body, log } = req
      const identifier = get(body, 'user.identifier') || user.loggedInAs

      log.trace(`${req.baseUrl} auth:`, { user, body })

      if (user.loggedInAs !== identifier) {
        log.warn(`Trying to update other user data! ${user.loggedInAs}!==${identifier}`)
        throw new Error(`Trying to update other user data! ${user.loggedInAs}!==${identifier}`)
      } else next()
    })
  )

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
      const log = req.log.child({ from: 'login-middleware' })

      log.debug('/auth/eth', 'authorizing')
      log.debug('/auth/eth', 'body:', req.body)

      const signature = req.body.signature
      const gdSignature = req.body.gdSignature
      const profileReqPublickey = req.body.profilePublickey
      const profileSignature = req.body.profileSignature
      const nonce = req.body.nonce
      const method = req.body.method
      const networkId = req.body.networkId

      if (networkId !== Config.ethereum.network_id) {
        log.warn('/auth/eth', 'Networkd id mismatch', { client: networkId, server: Config.ethereum.network_id })
        throw new Error('Network ID mismatch')
      }
      log.debug('/auth/eth', { signature, method })

      const msg = 'Login to GoodDAPP'
      const recovered = recoverPublickey(signature, msg, nonce)
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      const profileVerified = await SEA.verify(profileSignature, profileReqPublickey)
      log.debug('/auth/eth', 'Recovered public key:', {
        recovered,
        gdPublicAddress,
        profileVerified,
        profileReqPublickey
      })

      if (recovered && gdPublicAddress && profileVerified && profileVerified === msg + nonce) {
        log.info(`SigUtil Successfully verified signer as ${recovered}`)

        const token = jwt.sign(
          { method: method, loggedInAs: recovered, gdAddress: gdPublicAddress, profilePublickey: profileReqPublickey },
          Config.jwtPassword
        )

        log.info('/auth/eth', `JWT token: ${token}`)

        res.json({ token })
        res.end()
      } else {
        log.warn('/auth/eth', 'SigUtil unable to recover the message signer')
        throw new Error('Unable to verify credentials')
      }
    })
  )

  app.post(
    '/auth/ping',
    requestRateLimiter(10),
    wrapAsync(async (req, res) => {
      res.json({ ping: new Date() })
      res.end()
    })
  )

  app.get(
    '/auth/test',
    passport.authenticate('jwt', { session: false }),
    wrapAsync((req, res) => {
      const log = req.log.child({ from: 'login-middleware' })

      log.debug('/auth/test', req.user)

      res.end()
    })
  )

  logger.child({ from: 'login-middleware' }).info('Done setup login middleware.')
}

export default setup

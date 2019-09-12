// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import * as ethUtil from 'ethereumjs-util'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import Config from '../server.config.js'
import AdminWallet from '../blockchain/AdminWallet'

const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = Config.jwtPassword

export const strategy = new Strategy(jwtOptions, async (jwtPayload, next) => {
  const log = logger.child({ from: 'loadtest-middleware' })
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

const recoverPublickey = (signature, msg, nonce) => {
  const sig = ethUtil.fromRpcSig(signature)

  const messageHash = ethUtil.keccak(
    `\u0019Ethereum Signed Message:\n${(msg.length + nonce.length).toString()}${msg}${nonce}`
  )

  const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
  const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey))
  return recovered
}

const setup = (app: Router) => {
  passport.use(strategy)

  app.use(passport.initialize())

  /**
   * Only for loadtets
   */
  app.post(
    '/test/add/whitelistUser',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('test'),
    wrapAsync(async (req, res, next) => {
      const { body, user } = req
      const gdSignature = body.gdSignature
      console.log('#############################################')
      console.log(gdSignature)
      console.log('#############################################')
      const nonce = body.nonce
      const msg = 'Login to GoodDAPP'
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      await AdminWallet.whitelistUser(gdPublicAddress, body.profilePublickey)
      res.json({ ok: 1 })
    })
  )

  logger.child({ from: 'loadtest-middleware' }).info('Done setup login middleware.')
}

export default setup

// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Router } from 'express'
import ethUtil from 'ethereumjs-util'
import { get } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'
import { GunDBPrivate } from '../gun/gun-middleware'
// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy

const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = 'G00DAPP'
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
export const strategy = new Strategy(jwtOptions, async (jwtPayload, next) => {
  const log = logger.child({ from: 'login-middleware' })
  // usually this would be a database call:
  const user = await GunDBPrivate.getUser(jwtPayload.loggedInAs)
  log.debug('payload received', { jwtPayload, user })
  // const user = { pubkey: jwtPayload.loggedInAs }
  if (user) {
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
      const pubkey = get(body, 'user.pubkey')

      log.trace(`${req.baseUrl} auth:`, { user, body })

      if (user.pubkey !== pubkey) {
        log.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
        throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
      } else next()
    })
  )

  app.post(
    '/auth/eth',
    lightLogs((req, res) => {
      const log = req.log.child({ from: 'login-middleware' })

      log.debug('/auth/eth', 'authorizing')
      log.debug('/auth/eth', 'body:', req.body)

      const signature = req.body.signature
      const reqPublicKey = req.body.pubkey
      const method = req.body.method

      log.debug('/auth/eth', { signature, reqPublicKey, method })

      const msg = 'Login to GoodDAPP'
      const sig = ethUtil.fromRpcSig(signature)

      log.debug('/auth/eth', 'Signature:', sig)

      const messageHash = ethUtil.keccak(`\u0019Ethereum Signed Message:\n${msg.length.toString()}${msg}`)

      const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
      const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey))

      log.debug('/auth/eth', 'Recovered public key:', { recovered })

      if (recovered.toLowerCase() === reqPublicKey.toLowerCase()) {
        log.info(`SigUtil Successfully verified signer as ${reqPublicKey}`)

        const token = jwt.sign({ method: method, loggedInAs: reqPublicKey }, 'G00DAPP')

        log.info('/auth/eth', `JWT token: ${token}`)

        res.json({ token })
        res.end()
      } else {
        log.error('/auth/eth', 'SigUtil unable to recover the message signer')
        throw new Error('Unable to verify credentials')
      }
    })
  )

  app.get(
    '/auth/test',
    passport.authenticate('jwt', { session: false }),
    lightLogs((req, res) => {
      const log = req.log.child({ from: 'login-middleware' })

      log.debug('/auth/test', req.user)

      res.end()
    })
  )

  logger.child({ from: 'login-middleware' }).info('Done setup login middleware.')
}

export default setup

import jwt from 'jsonwebtoken'
import passport from 'passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import express from 'express'
import ethUtil from 'ethereumjs-util'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync } from '../server-middlewares'
import { GunDBPrivate } from '../gun/gun-middleware'
// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy

const log = logger.child({ from: 'login-middleware' })

const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = 'G00DAPP'
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
export const strategy = new Strategy(jwtOptions, async (jwtPayload, next) => {
  // usually this would be a database call:
  let user = await GunDBPrivate.getUser(jwtPayload.loggedInAs)
  log.debug('payload received', { jwtPayload, user })
  //if user is empty make sure we have something
  user = defaults(user, { pubkey: jwtPayload.loggedInAs })
  // const user = { pubkey: jwtPayload.loggedInAs }
  if (get(jwtPayload, 'loggedInAs')) {
    next(null, user)
  } else {
    next(null, false)
  }
})

const setup = (app: express) => {
  passport.use(strategy)
  app.use(passport.initialize())
  app.use(
    ['/user/*'],
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, body, log } = req
      log.trace(`${req.baseUrl} auth:`, { user, body })
      const pubkey = get(body, 'user.pubkey')
      if (user.pubkey !== pubkey) {
        log.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
        throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
      } else next()
    })
  )

  app.post('/auth/eth', (req, res) => {
    log.debug('/auth/eth', 'authorizing')
    log.debug('/auth/eth', 'body:', req.body)

    let signature = req.body.signature
    let reqPublicKey = req.body.pubkey
    let method = req.body.method

    log.debug('/auth/eth', { signature, reqPublicKey, method })

    const msg = 'Login to GoodDAPP'
    const sig = ethUtil.fromRpcSig(signature)

    log.debug('/auth/eth', 'Signature:', sig)

    const messageHash = ethUtil.keccak(`\u0019Ethereum Signed Message:\n${msg.length.toString()}${msg}`)

    const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
    const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey))

    log.debug('/auth/eth', 'Recovered public key:', { recovered })

    if (recovered.toLowerCase() === reqPublicKey.toLowerCase()) {
      logger.info(`SigUtil Successfully verified signer as ${reqPublicKey}`)

      const token = jwt.sign({ method: method, loggedInAs: reqPublicKey }, 'G00DAPP')

      log.info('/auth/eth', `JWT token: ${token}`)

      res.json({ token })
      res.end()
    } else {
      log.error('/auth/eth', 'SigUtil unable to recover the message signer')
      throw new Error('Unable to verify credentials')
    }
  })

  app.get('/auth/test', passport.authenticate('jwt', { session: false }), (req, res) => {
    log.debug('auth/test', req.user)

    res.end()
  })

  logger.info('Done setup login middleware.')
}

export default setup

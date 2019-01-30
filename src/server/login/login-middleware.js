import jwt from "jsonwebtoken"
import passport from "passport"
import { ExtractJwt, Strategy } from "passport-jwt"
import express from "express"
import ethUtil from "ethereumjs-util"
import { get } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync } from '../server-middlewares'

// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy


const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = "G00DAPP";
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
const strategy = new Strategy(jwtOptions, ((jwtPayload, next) => {
  const log = logger.child({ from: 'login-middleware - strategy' })

  log.debug('payload received', jwtPayload);

  // usually this would be a database call:
  const user = { pubkey: jwtPayload.loggedInAs }
  if (user) {
    next(null, user);
  } else {
    next(null, false);
  }
}));


const setup = (app:express) => {
  passport.use(strategy);
  app.use(passport.initialize());
  app.use(['/verify/*','/user/*'], passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const { user, body, log } = req
    log.trace(`${req.baseUrl} auth:`, { user, body })
    const pubkey = get(body, 'user.pubkey')
    if (user.pubkey !== pubkey) {
      log.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`);
      throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
    } else next()
  }))

  app.post("/auth/eth", (req, res) => {
    const log = req.log.child({ from: 'login-middleware - auth/eth' })

    log.debug('authorizing')
    log.debug('body:', req.body)

    let signature = req.body.signature
    let reqPublicKey = req.body.publicKey
    let method    = req.body.method

    log.debug({ signature })
    log.debug({ reqPublicKey })
    log.debug({ method })

    const msg = "Login to GoodDAPP"
    const sig = ethUtil.fromRpcSig(signature)

    log.debug('Signature:', sig)

    const messageHash = ethUtil.keccak(
      `\u0019Ethereum Signed Message:\n${msg.length.toString()}${msg}`
    )

    const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
    const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey));

    log.debug('Recovered public key:', { recovered })

    if (recovered.toLowerCase() === reqPublicKey.toLowerCase()) {
      log.info(`SigUtil Successfully verified signer as ${reqPublicKey}`)

      const token = jwt.sign({ method: method, loggedInAs: reqPublicKey }, "G00DAPP");

      log.info(`JWT token: ${token}`)

      res.json({ token });
      res.end();
    } else {
      log.error('SigUtil unable to recover the message signer')
      throw new Error("Unable to verify credentials")
    }
  });


  app.get("/auth/test", passport.authenticate("jwt", { session: false }), (req, res) => {
    const log = req.log.child({ from: 'login-middleware - auth/test' })

    log.debug(req.user)

    res.end()
  })
  
  logger
    .child({ from: 'login-middleware - setup' })
    .info("Done setup login middleware.")
}

export default setup

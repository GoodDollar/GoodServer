import jwt from "jsonwebtoken"
import passport from "passport"
import { ExtractJwt, Strategy } from "passport-jwt"
import express from "express"
import ethUtil from "ethereumjs-util"
import { get } from 'lodash'
import pino from '../../imports/pino-logger'
import { wrapAsync } from '../server-middlewares'

// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy
const logger = pino.child({ from: 'login-middleware' })

const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = "G00DAPP";
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
const strategy = new Strategy(jwtOptions, ((jwtPayload, next) => {
  logger.debug('payload received', jwtPayload);

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
  app.use(['/user/*'], passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const { user, body, log } = req
    logger.trace(`${req.baseUrl} auth:`, { user, body })
    const pubkey = get(body, 'user.pubkey')
    if (user.pubkey !== pubkey) {
      logger.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`);
      throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
    } else next()
  }))

  app.post("/auth/eth", (req, res) => {

    logger.debug('authorizing')
    logger.debug('body:', req.body)

    const signature = req.body.signature
    const reqPublicKey = req.body.pubkey
    const method = req.body.method

    logger.debug({ signature })
    logger.debug({ reqPublicKey })
    logger.debug({ method })

    const msg = "Login to GoodDAPP"
    const sig = ethUtil.fromRpcSig(signature)

    logger.debug('Signature:', sig)

    const messageHash = ethUtil.keccak(
      `\u0019Ethereum Signed Message:\n${msg.length.toString()}${msg}`
    )

    const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
    const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey));

    logger.debug('Recovered public key:', { recovered })

    if (recovered.toLowerCase() === reqPublicKey.toLowerCase()) {
      logger.info(`SigUtil Successfully verified signer as ${reqPublicKey}`)

      const token = jwt.sign({ method, loggedInAs: reqPublicKey }, "G00DAPP");

      logger.info(`JWT token: ${token}`)

      res.json({ token });
      res.end();
    } else {
      logger.error('SigUtil unable to recover the message signer')
      throw new Error("Unable to verify credentials")
    }
  });


  app.get("/auth/test", passport.authenticate("jwt", { session: false }), (req, res) => {
    logger.debug(req.user)
    res.end()
  })

  logger.info("Done setup login middleware.")
}

export default setup

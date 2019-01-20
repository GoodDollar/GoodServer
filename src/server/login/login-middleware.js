import jwt from "jsonwebtoken"
import passport from "passport"
import { ExtractJwt, Strategy } from "passport-jwt"
import express from "express"
import ethUtil from "ethereumjs-util"
//import console from "../../imports/logger"

// const ExtractJwt = passportJWT.ExtractJwt
// const JwtStrategy = passportJWT.Strategy


const jwtOptions = {}
jwtOptions.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()
jwtOptions.secretOrKey = "G00DAPP";
// jwtOptions.issuer = 'accounts.examplesoft.com';
// jwtOptions.audience = 'yoursite.net';
const strategy = new Strategy(jwtOptions, ((jwtPayload, next) => {
  console.debug("payload received", jwtPayload);
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
  app.post("/auth/eth", (req, res) => {
    console.debug("authorizing")
    console.debug("body:",req.body)
    let signature = req.body.signature
    let reqPublicKey = req.body.publicKey
    let method    = req.body.method
    console.debug({signature})
    console.debug({reqPublicKey})
    console.debug({method})

    const msg = "Login to GoodDAPP"
    const sig = ethUtil.fromRpcSig(signature)
    console.debug(sig)
    const messageHash = ethUtil.keccak(
      `\u0019Ethereum Signed Message:\n${msg.length.toString()}${msg}`
    )

    const publicKey = ethUtil.ecrecover(messageHash, sig.v, sig.r, sig.s)
    const recovered = ethUtil.bufferToHex(ethUtil.pubToAddress(publicKey));
    console.debug({recovered})
    if (recovered.toLowerCase() === reqPublicKey.toLowerCase()) {
      console.info(`SigUtil Successfully verified signer as ${reqPublicKey}`);
      const token = jwt.sign({ method: method, loggedInAs: reqPublicKey }, "G00DAPP");
      console.info(`JWT token: ${token}`);
      res.json({ token });
      res.end();
    } else {
      console.error("SigUtil unable to recover the message signer");
      throw new Error("Unable to verify credentials")
    }
  });


  app.get("/auth/test", passport.authenticate("jwt", { session: false }), (req, res) => {
    console.debug(req.user)
    res.end()
  })
  
  console.info("Done setup login middleware.")
}

export default setup

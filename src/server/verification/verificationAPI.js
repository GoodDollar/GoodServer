// @flow
import passport from "passport"
import { get } from 'lodash'
import {type UserRecord, StorageAPI, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'

function wrapAsync(fn) {
  return function (req, res, next) {
    // Make sure to `.catch()` any errors and pass them along to the `next()`
    // middleware in the chain, in this case the error handler.
    fn(req, res, next).catch(next);
  };
}

const setup = (app:express, verifier:VerificationAPI, storage:StorageAPI) => {
  app.post("/verify/user", passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const user:UserRecord = req.user
    const { verificationData } = req.body
    if (verifier.verifyUser(user, verificationData)) { 
      await AdminWallet.whitelistUser(user.pubkey)
      await storage.updateUser({ pubkey: user.pubkey, isVerified: true })
      res.json( { ok: 1 } ) 
    } else { throw new Error("Can't verify user") }
  }))

}

export default setup

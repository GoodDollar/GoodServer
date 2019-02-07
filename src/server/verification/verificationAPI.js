// @flow
import { Router } from 'express'
import passport from "passport"
import { get } from 'lodash'
import {type UserRecord, StorageAPI, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { wrapAsync } from '../server-middlewares'
import pino from '../../imports/pino-logger'

const log = pino.child({ from: 'verificationAPI' })

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  app.post("/verify/user", passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    log.debug('User:', req.user)
    log.debug('Body:', req.body)
    const user: UserRecord = req.user
    const { verificationData } = req.body
    if (verifier.verifyUser(user, verificationData)) {
      await AdminWallet.whitelistUser(user.pubkey)
      const updatedUser = await storage.updateUser({ pubkey: user.pubkey, isVerified: true })
      log.debug('updateUser:', updatedUser)
      res.json( { ok: 1 } )
    } else { throw new Error("Can't verify user") }
  }))

}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import { type UserRecord, StorageAPI, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { wrapAsync, onlyInProduction } from '../utils/helpers'

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  app.post('/verify/user', passport.authenticate('jwt', { session: false }), wrapAsync(async (req, res, next) => {
    const log = req.log.child({ from: 'verificationAPI - verify/user' })
    log.debug('User:', req.user)
    log.debug('Body:', req.body)
    const user: UserRecord = req.user
    const { verificationData } = req.body
    const verified = await verifier.verifyUser(user, verificationData)
    if (verified) {
      await AdminWallet.whitelistUser(user.pubkey)
      const updatedUser = await storage.updateUser({ pubkey: user.pubkey, isVerified: true })
      log.debug('updateUser:', updatedUser)
      res.json({ ok: 1 })
    } else { throw new Error("Can't verify user") }
  }))

  app.post("/verify/sendotp", passport.authenticate("jwt", { session: false }), onlyInProduction, wrapAsync(async (req, res, next) => {
    const { body: { user } } = req

    const [, otp] = await sendOTP(user)
    storage.storeOTP(user, otp)

    res.json({ ok: 1 })
  }))

  app.post('/verify/mobile', passport.authenticate('jwt', { session: false }), onlyInProduction, wrapAsync(async (req, res, next) => {
    const { user, body: { verificationData }, log: logger }: { user: UserRecord, body: { verificationData: { otp: string } }, log: any } = req
    const log = logger.child({ from: 'verificationAPI - verify/mobile' })

    log.debug('mobile verified', user, verificationData)

    await verifier.verifyMobile(user, verificationData)
    await GunDBPrivate.deleteOTP(user)

    res.json({ ok: 1 })
  }))
}

export default setup

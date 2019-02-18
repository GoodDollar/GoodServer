// @flow
import { Router } from 'express'
import passport from 'passport'
import { type UserRecord, StorageAPI, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { wrapAsync, onlyInProduction } from '../utils/helpers'
import { sendOTP } from '../../imports/otp'
import conf from '../server.config'

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  app.post(
    '/verify/user',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
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
      } else {
        throw new Error("Can't verify user")
      }
    })
  )

  app.post(
    '/verify/sendotp',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verification API - verify/sendotp' })
      const { body } = req
      const [, code] = await sendOTP(body.user)
      const expirationDate = Date.now() + +conf.otpTtlMinutes * 60 * 1000

      await storage.updateUser({ ...body.user, otp: { code, expirationDate } })

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/verify/mobile',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/mobile' })
      const { user, body } = req
      const verificationData: { otp: string } = body.verificationData

      log.debug('mobile verified', { user, verificationData })

      await verifier.verifyMobile(user, verificationData)

      const storedUser = await storage.getUser(user.pubkey)
      log.debug('storedUser', { storedUser })
      storedUser.smsValidated = true

      const sanitizedUser = storage.sanitizeUser(storedUser)
      log.debug('sanitizedUser', { sanitizedUser })
      await storage.updateUser(sanitizedUser)

      res.json({ ok: 1 })
    })
  )
}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInProduction, wrapAsync } from '../utils/helpers'
import { sendOTP } from '../../imports/otp'
import conf from '../server.config'
import { GunDBPublic } from '../gun/gun-middleware'
import { sendEmailConfirmationLink } from '../send/send'

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  app.post(
    '/verify/user',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/user' })
      const user: LoggedUser = req.user
      const { verificationData } = req.body
      const verified = await verifier.verifyUser(user, verificationData)
      if (verified) {
        log.debug('Whitelisting new user', user)
        await AdminWallet.whitelistUser(user.gdAddress, user.profilePublickey)
        const updatedUser = await storage.updateUser({ identifier: user.loggedInAs, isVerified: true })
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

      await verifier.verifyMobile({ identifier: user.loggedInAs }, verificationData)
      await storage.updateUser({ identifier: user.loggedInAs, smsValidated: true })
      const signedMobile = await GunDBPublic.signClaim(user.profilePubkey, { hasMobile: user.mobile })
      res.json({ ok: 1, attestation: signedMobile })
    })
  )

  app.post(
    '/verify/topwallet',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/topwallet' })
      const user: LoggedUser = req.user
      //allow topping once a day

      let txRes = await AdminWallet.topWallet(user.gdAddress, user.lastTopWallet)
        .then(tx => {
          log.debug('topping wallet tx', { walletaddress: user.gdAddress, tx })
          storage.updateUser({ identifier: user.loggedInAs, lastTopWallet: new Date().toISOString() })
          return { ok: 1 }
        })
        .catch(e => {
          log.error('Failed top wallet tx', e.message, e.stack)
          return { ok: -1, err: e.message }
        })
      log.info('topping wallet', { txRes, loggedInAs: user.loggedInAs, adminBalance: await AdminWallet.getBalance() })

      res.json(txRes)
    })
  )

  app.post(
    '/verify/sendemail',
    passport.authenticate('jwt', { session: false }),
    //onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/sendemail' })
      const { user, body } = req

      log.info({ user, body })

      const code = await sendEmailConfirmationLink(body.user)

      // updates/adds user with the emailVerificationCode to be used for verification later
      await storage.updateUser({ identifier: user.loggedInAs, emailVerificationCode: code })

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/verify/email',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/email' })
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData

      log.debug('email verified', { user, verificationData })

      await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)

      // if verification succeeds, then set the flag `isEmailConfirmed` to true in the user's record
      await storage.updateUser({ identifier: user.loggedInAs, isEmailConfirmed: true })

      const signedEmail = await GunDBPublic.signClaim(req.user.profilePubkey, { hasEmail: user.email })

      res.json({ ok: 1, attestation: signedEmail })
    })
  )

  app.post(
    '/verify/facerecognition',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/facerecognition' })
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData

      // recieve zoomclient params from client:

      /* this is the client type:
     apiResult: await this.client.enroll({
          email: this.props.email,
          name: this.props.name,
          sessionId: this.props.result.sessionId,
          facemap: this.props.result.facemap,
          auditTrailImage: this.props.result.auditTrailImage
        })
     */

      // pass the above exactly to Ruby backend.

      //res.json({ ok: 1, attestation: signedEmail })
      res.json({ ok: 1 })
    })
  )
}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import _ from 'lodash'
import multer from 'multer'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import { sendOTP, generateOTP } from '../../imports/otp'
import conf from '../server.config'
import { GunDBPublic } from '../gun/gun-middleware'
import { Mautic } from '../mautic/mauticAPI'
import fs from 'fs'

const fsPromises = fs.promises
const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  var upload = multer({ dest: 'uploads/' }) // to handle blob parameters of faceReco
  app.post(
    '/verify/facerecognition',
    passport.authenticate('jwt', { session: false }),
    upload.any(),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'livenesstest' })
      const { body, files, user } = req
      const verificationData = {
        facemapFile: _.get(_.find(files, { fieldname: 'facemap' }), 'path', ''),
        auditTrailImageFile: _.get(_.find(files, { fieldname: 'auditTrailImage' }), 'path', ''),
        enrollmentIdentifier: body.enrollmentIdentifier,
        sessionId: body.sessionId
      }
      let result = { ok: 1 }
      if (!user.isVerified && !['development'].includes(conf.env))
        result = await verifier.verifyUser(user, verificationData).finally(() => {
          //cleanup
          log.info('cleaning up facerecognition files')
          fsPromises.unlink(verificationData.facemapFile)
          fsPromises.unlink(verificationData.auditTrailImageFile)
        })
      else {
        result = { ok: 1, isVerified: true, enrollResult: { alreadyEnrolled: true } } // skip facereco only in dev mode
      }
      if (result.isVerified) {
        log.debug('Whitelisting new user', user)
        await Promise.all([
          AdminWallet.whitelistUser(user.gdAddress, user.profilePublickey),
          storage
            .updateUser({ identifier: user.loggedInAs, isVerified: true })
            .then(updatedUser => log.debug('updatedUser:', updatedUser))
        ])
      }
      res.json(result)
    })
  )
  app.post(
    '/verify/user',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/user' })
      const user: LoggedUser = req.user
      const { verificationData } = req.body
      const verified = true
      if (verified) {
        log.debug('Whitelisting new user', user)
        //dont whitelist if already whitelisted
        if (!(await AdminWallet.isVerified(user.gdAddress)))
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
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const { user, body } = req

      let userRec: UserRecord = _.defaults(body.user, user, { identifier: user.loggedInAs })
      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData(userRec))) {
        return res.json({ ok: 0, error: 'Mobile already exists, please use a different one.' })
      }
      if (!userRec.smsValidated) {
        const [, code] = await sendOTP(body.user)
        const expirationDate = Date.now() + +conf.otpTtlMinutes * 60 * 1000

        await storage.updateUser({ identifier: user.loggedInAs, otp: { code, expirationDate } })
      }
      res.json({ ok: 1 })
    })
  )

  app.post(
    '/verify/mobile',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/mobile' })
      const { user, body } = req
      const verificationData: { otp: string } = body.verificationData

      log.debug('mobile verified', { user, verificationData })
      if (!user.smsValidated) {
        let verified = await verifier.verifyMobile({ identifier: user.loggedInAs }, verificationData).catch(e => {
          log.warn('mobile verification failed:', e)
          res.json(400, { ok: 0, error: 'OTP FAILED', message: e.message })
          return false
        })
        if (verified === false) return
        await storage.updateUser({ identifier: user.loggedInAs, smsValidated: true })
      }
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
  /**
   * Send verification email endpoint
   */
  app.post(
    '/verify/sendemail',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/sendemail' })
      const { user, body } = req
      // log.info({ user, body })
      //merge user details for use by mautic
      let userRec: UserRecord = _.defaults(body.user, user)
      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData(userRec))) {
        return res.json({ ok: 0, error: 'Email already exists, please use a different one' })
      }
      if (!user.mauticId) {
        //first time create contact for user in mautic
        const mauticContact = await Mautic.createContact(userRec)
        userRec.mauticId = mauticContact.contact.fields.all.id
        log.debug('created new user mautic contact', userRec)
      }
      if (conf.skipEmailVerification === false) {
        const code = generateOTP(10)
        if (!user.isEmailConfirmed) {
          const validationLink = `${conf.walletUrl}/Signup/EmailConfirmation/?validation=${code}`
          Mautic.sendVerificationEmail(userRec, validationLink)
          log.debug('send new user email validation link', validationLink)
        }
        // updates/adds user with the emailVerificationCode to be used for verification later and with mauticId
        await storage.updateUser({
          identifier: user.loggedInAs,
          mauticId: userRec.mauticId,
          emailVerificationCode: code
        })
      }

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/verify/email',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/email' })
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData

      log.debug('email verified', { user, verificationData })
      if (!user.isEmailConfirmed) {
        await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)

        // if verification succeeds, then set the flag `isEmailConfirmed` to true in the user's record
        await storage.updateUser({ identifier: user.loggedInAs, isEmailConfirmed: true })
      }
      const signedEmail = await GunDBPublic.signClaim(req.user.profilePubkey, { hasEmail: user.email })

      res.json({ ok: 1, attestation: signedEmail })
    })
  )
}

export default setup

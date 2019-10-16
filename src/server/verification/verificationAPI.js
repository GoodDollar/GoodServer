// @flow
import { Router } from 'express'
import passport from 'passport'
import _ from 'lodash'
import multer from 'multer'
import fetch from 'cross-fetch'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import fuseapi from '../utils/fuseapi'
import { sendOTP, generateOTP } from '../../imports/otp'
import conf from '../server.config'
import { GunDBPublic } from '../gun/gun-middleware'
import { Mautic } from '../mautic/mauticAPI'
import fs from 'fs'
import md5 from 'md5'

const fsPromises = fs.promises
const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  var upload = multer({ dest: 'uploads/' }) // to handle blob parameters of faceReco

  /**
   * @api {post} /verify/facerecognition Verify users face
   * @apiName Face Recognition
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} sessionId
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Boolean} isVerified
   * @apiSuccess {Object} enrollResult: { alreadyEnrolled: true }
   * @apiSuccess {Boolean} enrollResult.alreadyEnrolled
   * @ignore
   */
  app.post(
    '/verify/facerecognition',
    passport.authenticate('jwt', { session: false }),
    upload.any(),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'facerecognition' })
      const { body, files, user } = req
      log.debug({ user })
      const sessionId = body.sessionId
      GunDBPublic.gun
        .get(sessionId)
        .get('isStarted')
        .put(true) // publish initialized data to subscribers
      log.debug('written FR status to gun', await GunDBPublic.gun.get(sessionId))

      const verificationData = {
        facemapFile: _.get(_.find(files, { fieldname: 'facemap' }), 'path', ''),
        auditTrailImageFile: _.get(_.find(files, { fieldname: 'auditTrailImage' }), 'path', ''),
        enrollmentIdentifier: body.enrollmentIdentifier,
        sessionId: sessionId
      }
      let result = { ok: 0 }
      if (!user.isVerified && !conf.skipFaceRecognition)
        result = await verifier
          .verifyUser(user, verificationData)
          .catch(e => {
            log.error('Facerecognition error:', e)
            GunDBPublic.gun.get(sessionId).put({ isNotDuplicate: false, isLive: false, isError: e.message })
            return { ok: 1, error: e.message, isVerified: false }
          })
          .finally(() => {
            //cleanup
            log.info('cleaning up facerecognition files')
            fsPromises.unlink(verificationData.facemapFile)
            fsPromises.unlink(verificationData.auditTrailImageFile)
          })
      else {
        GunDBPublic.gun.get(sessionId).put({ isNotDuplicate: true, isLive: true, isEnrolled: true }) // publish to subscribers
        // mocked result for verified user or development mode
        result = {
          ok: 1,
          isVerified: true,
          enrollResult: { alreadyEnrolled: true, enrollmentIdentifier: verificationData.enrollmentIdentifier }
        } // skip facereco only in dev mode
      }
      log.debug('Facerecogintion result:', result)
      if (result.isVerified) {
        log.debug('Whitelisting new user', user)
        await Promise.all([
          AdminWallet.whitelistUser(user.gdAddress, user.profilePublickey),
          storage
            .updateUser({ identifier: user.loggedInAs, isVerified: true })
            .then(updatedUser => log.debug('updatedUser:', updatedUser))
        ])
          .then(
            _ =>
              GunDBPublic.gun
                .get(sessionId)
                .get('isWhitelisted')
                .put(true) // publish to subscribers
          )
          .catch(e => {
            log.error('Whitelisting failed', e)
            GunDBPublic.gun.get(sessionId).put({ isWhitelisted: false, isError: e.message })
          })
      }
      res.json(result)
    })
  )

  /**
   * @api {post} /verify/sendotp Sends OTP
   * @apiName Send OTP
   * @apiGroup Verification
   *
   * @apiParam {UserRecord} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/sendotp',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const { user, body } = req
      const log = req.log.child({ from: 'otp' })

      log.info('otp request:', user, body)

      const { mobile } = body.user

      let userRec: UserRecord = _.defaults(body.user, user, { identifier: user.loggedInAs })
      const savedMobile = userRec.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData(userRec))) {
        return res.json({ ok: 0, error: 'Mobile already exists, please use a different one.' })
      }

      log.debug('sending otp:', user.loggedInAs)

      if (!userRec.smsValidated || mobile !== savedMobile) {
        const [, code] = await sendOTP({ mobile })
        const expirationDate = Date.now() + +conf.otpTtlMinutes * 60 * 1000
        log.debug('otp sent:', user.loggedInAs)
        await storage.updateUser({
          identifier: user.loggedInAs,
          otp: {
            ...userRec.otp,
            code,
            expirationDate,
            mobile
          }
        })
      }

      res.json({ ok: 1 })
    })
  )

  /**
   * @api {post} /verify/mobile Verify mobile data code
   * @apiName OTP Code
   * @apiGroup Verification
   *
   * @apiParam {Object} verificationData
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Claim} attestation
   * @ignore
   */
  app.post(
    '/verify/mobile',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/mobile' })
      const { user, body } = req
      const verificationData: { otp: string } = body.verificationData
      const savedMobile = user.otp && user.otp.mobile
      const currentMobile = user.mobile

      log.debug('mobile verified', { user, verificationData })

      if (!user.smsValidated || currentMobile !== savedMobile) {
        let verified = await verifier.verifyMobile({ identifier: user.loggedInAs }, verificationData).catch(e => {
          log.warn('mobile verification failed:', e)

          res.json(400, { ok: 0, error: 'OTP FAILED', message: e.message })

          return false
        })

        if (verified === false) return

        await storage.updateUser({ identifier: user.loggedInAs, smsValidated: true, mobile: savedMobile })
      }

      const signedMobile = await GunDBPublic.signClaim(user.profilePubkey, { hasMobile: savedMobile })

      res.json({ ok: 1, attestation: signedMobile })
    })
  )

  /**
   * @api {post} /verify/topwallet Tops Users Wallet if needed
   * @apiName Top Wallet
   * @apiGroup Verification
   *
   * @apiParam {LoggedUser} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/topwallet',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/topwallet' })
      const user: LoggedUser = req.user
      // check if user send ether out of the good dollar system
      let isUserSendEtherOutOfSystem = false
      try {
        const { result = [] } = await fuseapi.getTxList({
          address: user.gdAddress,
          page: 1,
          offset: 10,
          filterby: 'from'
        })
        isUserSendEtherOutOfSystem = result.some(r => Number(r.value) > 0)
      } catch (e) {
        log.error('Check user transactions error', e)
      }

      if (isUserSendEtherOutOfSystem) {
        log.error('User send ether out of system')

        return res.json({
          ok: 0,
          sendEtherOutOfSystem: true
        })
      }

      //allow topping once a day
      await storage.updateUser({ identifier: user.loggedInAs, lastTopWallet: new Date().toISOString() })
      let txRes = await AdminWallet.topWallet(user.gdAddress, user.lastTopWallet)
        .then(tx => {
          log.debug('topping wallet tx', { walletaddress: user.gdAddress, tx })
          return { ok: 1 }
        })
        .catch(async e => {
          log.error('Failed top wallet tx', e.message, e.stack)
          //restore last top wallet in case of error
          await storage.updateUser({ identifier: user.loggedInAs, lastTopWallet: user.lastTopWallet })

          return { ok: -1, error: e.message }
        })
      log.info('topping wallet', { txRes, loggedInAs: user.loggedInAs, adminBalance: await AdminWallet.getBalance() })

      res.json(txRes)
    })
  )

  /**
   * @api {post} /verify/email Send verification email endpoint
   * @apiName Send Email
   * @apiGroup Verification
   *
   * @apiParam {UserRecord} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/sendemail',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/sendemail' })

      const { user, body } = req
      const { email } = body.user

      //merge user details for use by mautic
      let userRec: UserRecord = _.defaults(body.user, user)
      const savedEmail = userRec.email

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData(userRec))) {
        return res.json({ ok: 0, error: 'Email already exists, please use a different one' })
      }
      if (!user.mauticId || user.email !== body.email) {
        //first time create contact for user in mautic
        const mauticContact = await Mautic.createContact(userRec)
        userRec.mauticId = mauticContact.contact.fields.all.id
        log.debug('created new user mautic contact', userRec)
      }

      if (conf.skipEmailVerification === false) {
        const code = generateOTP(6)
        if (!user.isEmailConfirmed || email !== savedEmail) {
          Mautic.sendVerificationEmail(userRec, code)
          log.debug('send new user email validation code', code)
        }

        // updates/adds user with the emailVerificationCode to be used for verification later and with mauticId
        await storage.updateUser({
          identifier: user.identifier,
          mauticId: userRec.mauticId,
          emailVerificationCode: code,
          otp: {
            ...userRec.otp,
            email
          }
        })
      }

      res.json({ ok: 1 })
    })
  )

  /**
   * @api {post} /verify/email Verify email code
   * @apiName Email
   * @apiGroup Verification
   *
   * @apiParam {Object} verificationData
   * @apiParam {String} verificationData.code
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Claim} attestation
   * @ignore
   */
  app.post(
    '/verify/email',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/email' })
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData
      const savedEmail = user.otp && user.otp.email
      const currentEmail = user.email

      log.debug('email verified', { user, verificationData })

      if (!user.isEmailConfirmed || currentEmail !== savedEmail) {
        await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)

        // if verification succeeds, then set the flag `isEmailConfirmed` to true in the user's record
        await storage.updateUser({ identifier: user.loggedInAs, isEmailConfirmed: true, email: savedEmail })
      }
      const signedEmail = await GunDBPublic.signClaim(req.user.profilePubkey, { hasEmail: savedEmail })

      res.json({ ok: 1, attestation: signedEmail })
    })
  )

  /**
   * @api {get} /verify/w3/email Verify email to be equal with email provided by token from web3
   * @apiName Web3 Email Verify
   * @apiGroup Verification
   *
   * @apiParam {String} email
   * @apiParam {String} token
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/w3/email',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/w3/email' })

      const { body, user: currentUser } = req
      const email: string = body.email
      const token: string = body.token

      if (!email || !token) {
        log.error('email and w3Token is required', { email, token })

        return res.status(422).json({
          ok: -1,
          message: 'email and w3Token is required'
        })
      }

      let w3User

      try {
        const _w3User = await fetch(`${conf.web3SiteUrl}/api/wl/user`, {
          method: 'GET',
          headers: {
            Authorization: token
          }
        }).then(res => res.json())

        const w3userData = _w3User.data
        w3User = w3userData.email && w3userData
      } catch (e) {
        log.error('Fetch web3 user error', e.message, e)
      }

      let status = 422
      const responsePayload = {
        ok: -1,
        message: 'Wrong web3 token or email'
      }

      if (w3User && w3User.email === email) {
        await storage.updateUser({ identifier: currentUser.loggedInAs, isEmailConfirmed: true })

        responsePayload.ok = 1
        delete responsePayload.message

        status = 200
      }

      res.status(status).json(responsePayload)
    })
  )

  /**
   * @api {get} /verify/w3/logintoken get W3 login token for current user
   * @apiName Get W3 Login Token
   * @apiGroup Verification
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {String} loginToken
   * @ignore
   */
  app.get(
    '/verify/w3/logintoken',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, log } = req
      const logger = log.child({ from: 'verificationAPI - login/token' })

      let loginToken = user.loginToken

      if (!loginToken) {
        const secureHash = md5(user.email + conf.secure_key)
        const web3Response = await fetch(`${conf.web3SiteUrl}/api/wl/user`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            secure_hash: secureHash.toLowerCase(),
            email: user.email
          })
        })
          .then(res => res.json())
          .catch(e => {
            logger.error('Get Web3 Login Response Failed', e)
          })

        const web3ResponseData = web3Response && web3Response.data

        if (web3ResponseData && web3ResponseData.login_token) {
          loginToken = web3ResponseData.login_token
        }
      }

      res.json({
        ok: +Boolean(loginToken),
        loginToken
      })
    })
  )
}

export default setup

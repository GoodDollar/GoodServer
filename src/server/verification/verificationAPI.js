// @flow
import fs from 'fs'
import { Router } from 'express'
import passport from 'passport'
import _ from 'lodash'
import multer from 'multer'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import gdToWei from '../utils/gdToWei'
import fuseapi from '../utils/fuseapi'
import { sendOTP, generateOTP } from '../../imports/otp'
import conf from '../server.config'
import { GunDBPublic } from '../gun/gun-middleware'
import { Mautic } from '../mautic/mauticAPI'
import txManager from '../utils/tx-manager'
import * as W3Helper from '../utils/W3Helper'

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
      let userRec: UserRecord = _.defaults(body.user, user, { identifier: user.loggedInAs })
      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData(userRec))) {
        return res.json({ ok: 0, error: 'Mobile already exists, please use a different one.' })
      }
      log.debug('sending otp:', user.loggedInAs)
      if (!userRec.smsValidated) {
        const [, code] = await sendOTP(body.user)
        const expirationDate = Date.now() + +conf.otpTtlMinutes * 60 * 1000
        log.debug('otp sent:', user.loggedInAs)
        await storage.updateUser({ identifier: user.loggedInAs, otp: { code, expirationDate } })
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
        const code = generateOTP(6)
        if (!user.isEmailConfirmed) {
          Mautic.sendVerificationEmail(userRec, code)
          log.debug('send new user email validation code', code)
        }
        // updates/adds user with the emailVerificationCode to be used for verification later and with mauticId
        storage.updateUser({
          identifier: user.loggedInAs,
          mauticId: userRec.mauticId,
          emailVerificationCode: code
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

  /**
   * @api {post} /verify/w3/email Verify email to be equal with email provided by token from web3
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
        w3User = await W3Helper.getUser(token)
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
   * @apiName Get
   * @apiGroup Storage
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
      const logger = log.child({ from: 'storageAPI - login/token' })

      let loginToken = user.loginToken

      if (!loginToken) {
        const w3Data = await W3Helper.getLoginOrWalletToken(user)

        if (w3Data && w3Data.login_token) {
          loginToken = w3Data.login_token

          storage.updateUser({ ...user, loginToken })
        }
      }

      logger.info('loginToken', loginToken)

      res.json({
        ok: +Boolean(loginToken),
        loginToken
      })
    })
  )

  /**
   * @api {get} /verify/bonuses check if there is available bonuses to charge on user's wallet and do it
   * @apiName Web3 Charge Bonuses
   * @apiGroup Verification
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.get(
    '/verify/w3/bonuses',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'verificationAPI - verify/bonuses' })

      const { user: currentUser } = req
      let wallet_token = currentUser.w3Token

      if (!wallet_token) {
        const w3Data = await W3Helper.getLoginOrWalletToken(currentUser)

        if (w3Data && w3Data.wallet_token) {
          wallet_token = w3Data.wallet_token

          storage.updateUser({ identifier: currentUser.loggedInAs, w3Token: w3Data.wallet_token })
        }
      }

      if (!wallet_token) {
        return res.status(400).json({
          ok: -1,
          message: 'Missed W3 token'
        })
      }

      const { release, fail } = await txManager.lock(currentUser.gdAddress, 0)

      const w3User = await W3Helper.getUser(wallet_token)

      if (!w3User) {
        release()

        return res.status(400).json({
          ok: -1,
          message: 'Missed bonuses data'
        })
      }

      const bonus = w3User.bonus
      const redeemedBonus = w3User.redeemed_bonus
      const toRedeem = +bonus - +redeemedBonus

      if (toRedeem <= 0) {
        release()

        return res.status(200).json({
          ok: 1,
          message: 'There is no bonuses yet'
        })
      }

      const toRedeemInWei = gdToWei(toRedeem)
      let txHash

      // initiate smart contract to send bonus to user
      try {
        txHash = await AdminWallet.redeemBonuses(currentUser.gdAddress, toRedeemInWei, {
          onReceipt: r => {
            log.info('Bonus charge - receipt received', r)

            W3Helper.informW3ThatBonusCharged(toRedeem, wallet_token)
          }
        })
      } catch (e) {
        log.error('Failed to charge bonuses for user', e.message, e)

        fail()

        return res.status(400).json({
          ok: -1,
          message: 'Failed to charge bonuses for user'
        })
      }

      release()

      res.status(200).json({
        bonusAmount: toRedeem,
        hash: txHash
      })
    })
  )
}

export default setup

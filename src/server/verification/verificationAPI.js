// @flow
import { Router } from 'express'
import passport from 'passport'
import _ from 'lodash'
import moment from 'moment'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import fuseapi from '../utils/fuseapi'
import { sendOTP, generateOTP } from '../../imports/otp'
import conf from '../server.config'
import { GunDBPublic } from '../gun/gun-middleware'
import { Mautic } from '../mautic/mauticAPI'
import W3Helper from '../utils/W3Helper'
import gdToWei from '../utils/gdToWei'
import txManager from '../utils/tx-manager'
import addUserSteps from '../storage/addUserSteps'

import createEnrollmentProcessor from './processor/EnrollmentProcessor.js'

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  /**
   * @api {delete} /verify/face/:enrollmentIdentifier Enqueue users face for disposal since 24th
   * @apiName Dispose Face
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} signature
   *
   * @ignore
   */
  app.delete(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { params, query, log, user } = req
      const { enrollmentIdentifier } = params
      const { signature } = query

      try {
        const processor = createEnrollmentProcessor(storage)
        await processor.enqueueDisposal(enrollmentIdentifier, signature, log)
      } catch (exception) {
        const { message } = exception
        log.error('delete face record failed:', { message, exception, enrollmentIdentifier, user })
        res.status(400).json({ success: false, error: message })
        return
      }

      res.json({ success: true })
    })
  )

  /**
   * @api {put} /verify/:enrollmentIdentifier Verify users face
   * @apiName Face Verification
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} sessionId
   *
   * @ignore
   */
  app.put(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, log, params, body: payload, isE2ERunning } = req
      const { enrollmentIdentifier } = params
      let enrollmentResult

      try {
        const { skipFaceVerification } = conf
        const enrollmentProcessor = createEnrollmentProcessor(storage)

        enrollmentProcessor.validate(user, enrollmentIdentifier, payload)

        // if user is already verified, we're skipping enroillment logic
        if (user.isVerified || skipFaceVerification || isE2ERunning) {
          // creating enrollment session manually for this user
          const enrollmentSession = enrollmentProcessor.createEnrollmentSession(user, log)
          // to access user's session reference in the Gun
          const { sessionRef } = enrollmentSession.initialize(payload)

          // immediately publishing isEnrolled to subscribers
          sessionRef.put({ isDuplicate: false, isLive: true, isEnrolled: true })
          enrollmentResult = { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } }

          // when FR is enabled and user is already verified,
          // we need to make sure to whitelist him,
          // maybe we changed the whitelisting contract and
          // he is no longer whitelisted there,
          // so we trust that we already whitelisted him in the past
          // and whitelist him again in the new contract
          if (!skipFaceVerification) {
            // checking for skipFaceVerification only
            // because on automated tests runs user also should be whitelisted
            try {
              // in the session's lifecycle onEnrollmentCompleted() is called
              // after enrollment was successfull
              // it whitelists user in the wallet and updates Gun's session
              // here we're calling it manually as we've skipped enroll()
              await enrollmentSession.onEnrollmentCompleted()
            } catch (exception) {
              // also we should try...catch manually,
              // on failure call call onEnrollmentFailed()
              // for set non-whitelistened and error in the Gun's session
              enrollmentSession.onEnrollmentFailed(exception)
              // and rethrow exception for return { success: false } JSON response
              throw exception
            }
          }
        } else {
          enrollmentResult = await enrollmentProcessor.enroll(user, enrollmentIdentifier, payload, log)
        }
      } catch (exception) {
        const { message } = exception

        log.error('Face verification error:', { message, exception, enrollmentIdentifier })
        res.status(400).json({ success: false, error: message })
        return
      }

      res.json(enrollmentResult)
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
    requestRateLimiter(),
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const { user, body } = req
      const log = req.log

      log.info('otp request:', { user, body })

      const mobile = body.user.mobile || user.otp.mobile

      let userRec: UserRecord = _.defaults(body.user, user, { identifier: user.loggedInAs })
      const savedMobile = user.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ mobile }))) {
        return res.json({ ok: 0, error: 'mobile_already_exists' })
      }

      log.debug('sending otp:', user.loggedInAs)

      if (!userRec.smsValidated || mobile !== savedMobile) {
        const [, code] = await sendOTP({ mobile })
        const expirationDate = Date.now() + +conf.otpTtlMinutes * 60 * 1000
        log.debug('otp sent:', user.loggedInAs, code)
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
      const log = req.log
      const { user, body } = req
      const verificationData: { otp: string } = body.verificationData
      const tempSavedMobile = user.otp && user.otp.mobile
      const currentMobile = user.mobile

      log.debug('mobile verified', { user, verificationData })

      if (!user.smsValidated || currentMobile !== tempSavedMobile) {
        let verified = await verifier.verifyMobile({ identifier: user.loggedInAs }, verificationData).catch(e => {
          log.warn('mobile verification failed:', { e })

          res.json(400, { ok: 0, error: 'OTP FAILED', message: e.message })

          return false
        })

        if (verified === false) return

        await storage.updateUser({ identifier: user.loggedInAs, smsValidated: true, mobile: tempSavedMobile })
      }

      const signedMobile = await GunDBPublic.signClaim(user.profilePubkey, { hasMobile: tempSavedMobile })

      res.json({ ok: 1, attestation: signedMobile })
    })
  )
  /**
   * @api {post} /verify/registration Verify user registration status
   * @apiName Verify Registration Status
   * @apiGroup Verification
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/registration',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const user = req.user
      res.json({ ok: user && user.createdDate ? 1 : 0 })
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
      const log = req.log
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
        log.error('Check user transactions error', { error: e.message, e })
      }

      if (isUserSendEtherOutOfSystem) {
        log.warn('User send ether out of system')

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
          log.error('Failed top wallet tx', { error: e.message, e })
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
    requestRateLimiter(),
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log

      const { user, body } = req
      const { email } = body.user

      //merge user details for use by mautic
      let userRec: UserRecord = _.defaults(body.user, user)
      const currentEmail = user.email
      const tempMauticId = user.otp && user.otp.tempMauticId

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ email }))) {
        return res.json({ ok: 0, error: 'Email already exists, please use a different one' })
      }

      if (conf.skipEmailVerification === false) {
        if ((!user.mauticId && !tempMauticId) || (currentEmail && currentEmail !== email)) {
          const mauticContact = await Mautic.createContact(userRec)

          //otp might be undefined so we use spread operator instead of userRec.otp.tempId=
          userRec.otp = {
            ...userRec.otp,
            tempMauticId: mauticContact.contact.fields.all.id
          }
          log.debug('created new user mautic contact', userRec)
        }

        const code = generateOTP(6)
        if (!user.isEmailConfirmed || email !== currentEmail) {
          try {
            await Mautic.sendVerificationEmail(
              {
                ...userRec,
                mauticId: (userRec.otp && userRec.otp.tempMauticId) || userRec.mauticId
              },
              code
            )
            log.debug('sent new user email validation code', code)
          } catch (e) {
            log.error('failed sending email verification to user:', { error: e.message, e, userRec, code })
            throw e
          }
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
      const log = req.log
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData
      const tempSavedEmail = user.otp && user.otp.email
      const tempSavedMauticId = user.otp && user.otp.tempMauticId
      const currentEmail = user.email

      log.debug('email verified', { user, body, verificationData, tempSavedMauticId, tempSavedEmail, currentEmail })

      if (!user.isEmailConfirmed || currentEmail !== tempSavedEmail) {
        await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)

        const updateUserUbj = {
          identifier: user.loggedInAs,
          isEmailConfirmed: true,
          email: tempSavedEmail,
          otp: {
            ...user.otp,
            tempMauticId: undefined
          }
        }

        if (user.mauticId) {
          await Promise.all([
            Mautic.deleteContact({
              mauticId: tempSavedMauticId
            }),
            Mautic.updateContact(user.mauticId, { email: tempSavedEmail })
          ])
        } else {
          updateUserUbj.mauticId = tempSavedMauticId
        }

        await storage.updateUser(updateUserUbj)
      }

      const signedEmail = await GunDBPublic.signClaim(req.user.profilePubkey, { hasEmail: tempSavedEmail })

      res.json({ ok: 1, attestation: signedEmail })
    })
  )

  /**
   * @api {post} /verify/hanuka-bonus Check hanuka bonus availability
   * @apiName Hanuka Bonus
   * @apiGroup Verification
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.get(
    '/verify/hanuka-bonus',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log
      const { user } = req
      const now = moment().utcOffset('+0200')
      const startHanuka = moment(conf.hanukaStartDate, 'DD/MM/YYYY').utcOffset('+0200')
      const endHanuka = moment(conf.hanukaEndDate, 'DD/MM/YYYY')
        .endOf('day')
        .utcOffset('+0200')

      if (startHanuka.isAfter(now) || now.isAfter(endHanuka)) {
        log.info('That is no the period of Hanuka bonus')

        return res.json({
          ok: 0,
          message: 'That is no the period of Hanuka bonus'
        })
      }

      const currentDayNumber = now.diff(startHanuka, 'days') + 1
      const dayField = `day${currentDayNumber}`

      if (user.hanukaBonus && user.hanukaBonus[dayField]) {
        log.info('The user already get Hanuka bonus today', { date: now, dayNumber: dayField, user })

        return res.json({
          ok: 0,
          message: 'The user already get Hanuka bonus today'
        })
      }

      const bonusInWei = gdToWei(currentDayNumber)

      log.debug('Hanuka Dates/Data for calculations', {
        now,
        currentDayNumber,
        dayField,
        bonusInWei,
        bonus: currentDayNumber
      })

      const { release, fail } = await txManager.lock(user.gdAddress, 0)

      AdminWallet.redeemBonuses(user.gdAddress, bonusInWei, {
        onTransactionHash: hash => {
          if (res.headersSent) {
            log.error('checkHanukaBonus got tx hash but headers already sent', { hash, user })
            return
          }
          return res.status(200).json({
            ok: 1,
            hash
          })
        },
        onReceipt: async r => {
          log.info('Bonus redeem - receipt received', r)

          await storage.updateUser({
            identifier: user.loggedInAs,
            hanukaBonus: {
              ...user.hanukaBonus,
              [dayField]: true
            }
          })

          release()
        },
        onError: e => {
          log.error('Bonuses charge failed', { errMessage: e.message, e, user })

          fail()

          if (!res.headersSent) {
            res.status(400).json({
              ok: -1,
              message: 'The error occurred while trying to send your bonus'
            })
          }
        }
      })
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
   * @apiSuccess {String} message
   * @ignore
   */
  app.post(
    '/verify/w3/email',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log

      const { body, user: currentUser } = req
      const email: string = body.email
      const token: string = body.token

      if (!email || !token) {
        log.warn('email and w3Token is required', { email, token })

        return res.status(422).json({
          ok: -1,
          message: 'email and w3Token is required'
        })
      }

      let w3User

      try {
        w3User = await W3Helper.getUser(token)
      } catch (e) {
        log.error('Fetch web3 user error', { errMessage: e.message, e })
      }

      let status = 422
      const responsePayload = {
        ok: -1,
        message: 'Wrong web3 token or email'
      }

      if (w3User && w3User.email === email) {
        currentUser.email = w3User.email
        const mauticContact = await Mautic.createContact(currentUser)
        const mauticId = mauticContact.contact.fields.all.id
        await storage.updateUser({
          identifier: currentUser.loggedInAs,
          mauticId,
          email,
          otp: { ...currentUser.otp, email },
          isEmailConfirmed: true
        })

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
      const { user } = req
      const logger = req.log

      if (conf.enableInvites === false) res.json({ ok: 0, message: 'invites disabled' })
      const w3Record = await addUserSteps.updateW3Record(user, logger) //make sure w3 registration was done
      let loginToken = w3Record.loginToken

      if (!loginToken) {
        const w3Data = await W3Helper.getLoginOrWalletToken(user)

        if (w3Data && w3Data.login_token) {
          loginToken = w3Data.login_token

          storage.updateUser({ ...user, loginToken })
        }
      }

      logger.info('loginToken', { loginToken })

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
      const log = req.log

      const { user: currentUser } = req

      if (conf.enableInvites === false) res.json({ ok: 0, message: 'invites disabled' })

      const isUserWhitelisted = await AdminWallet.isVerified(currentUser.gdAddress)

      log.info('currentUser', { currentUser })
      log.info('isUserWhitelisted', { isUserWhitelisted })

      if (!isUserWhitelisted) {
        return res.status(200).json({
          ok: 0,
          message: 'User should be verified to get bonuses'
        })
      }

      AdminWallet.checkHanukaBonus(currentUser, storage).catch(e =>
        log.error('checkHnukaBonus failed', { error: e.message, e })
      )

      let wallet_token = currentUser.w3Token

      log.info('wallet token from user rec', { wallet_token })

      if (!wallet_token) {
        const w3Data = await W3Helper.getLoginOrWalletToken(currentUser)

        log.info('wallet token response data from w3 site', { w3Data })
        log.info('wallet token from w3 site', { walletToken: w3Data && w3Data.wallet_token })

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

      const isQueueLocked = await txManager.isLocked(currentUser.gdAddress)

      log.info('Is Queue Locked', { isQueueLocked })

      if (isQueueLocked) {
        return res.status(200).json({
          ok: 1,
          message: 'The bonuses are in minting process'
        })
      }

      //start lock before checking bonus status to prevent race condition
      const { release, fail } = await txManager.lock(currentUser.gdAddress, 0)

      const w3User = await W3Helper.getUser(wallet_token).catch(e => {
        log.error('failed fetching w3 user', { errMessage: e.message, e, wallet_token, currentUser })
        return false
      })

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

      log.debug('user address and bonus', {
        address: currentUser.gdAddress,
        bonus: toRedeem,
        bonusInWei: toRedeemInWei
      })

      // initiate smart contract to send bonus to user
      AdminWallet.redeemBonuses(currentUser.gdAddress, toRedeemInWei, {
        onTransactionHash: hash => {
          log.info('Bonus redeem - hash created', { currentUser, hash })
        },
        onReceipt: async r => {
          log.info('Bonus redeem - receipt received', r)

          await W3Helper.informW3ThatBonusCharged(toRedeem, wallet_token)

          release()
        },
        onError: e => {
          log.error('Bonuses charge failed', { errMessage: e.message, e, currentUser })

          fail()

          return res.status(400).json({
            ok: -1,
            message: 'Failed to redeem bonuses for user'
          })
        }
      })

      return res.status(200).json({
        ok: 1
      })
    })
  )
}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import { get, defaults } from 'lodash'
import moment from 'moment'
import { sha3 } from 'web3-utils'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import fuseapi from '../utils/fuseapi'
import { sendOTP, generateOTP } from '../../imports/otp'
import conf from '../server.config'
import { Mautic } from '../mautic/mauticAPI'
import W3Helper from '../utils/W3Helper'
import gdToWei from '../utils/gdToWei'
import txManager from '../utils/tx-manager'

import createEnrollmentProcessor from './processor/EnrollmentProcessor.js'

const setup = (app: Router, verifier: VerificationAPI, gunPublic: StorageAPI, storage: StorageAPI) => {
  /**
   * @api {delete} /verify/face/:enrollmentIdentifier Enqueue user's face snapshot for disposal since 24h
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

        await processor.enqueueDisposal(user, enrollmentIdentifier, signature, log)
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
   * @api {get} /verify/face/:enrollmentIdentifier Checks is face snapshot enqueued enqueued for disposal. Return disposal state
   * @apiName Check face disposal state
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   *
   * @ignore
   */
  app.get(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { params, log, user } = req
      const { enrollmentIdentifier } = params

      try {
        const processor = createEnrollmentProcessor(storage)
        const isDisposing = await processor.isEnqueuedForDisposal(enrollmentIdentifier, log)

        res.json({ success: true, isDisposing })
      } catch (exception) {
        const { message } = exception
        log.error('face record disposing check failed:', { message, exception, enrollmentIdentifier, user })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {post} /verify/face/session Issues session token for a new enrollment session
   * @apiName Issue enrollment session token
   * @apiGroup Verification
   *
   * @ignore
   */
  app.post(
    '/verify/face/session',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { log, user } = req

      try {
        const processor = createEnrollmentProcessor(storage)
        const sessionToken = await processor.issueSessionToken(log)

        res.json({ success: true, sessionToken })
      } catch (exception) {
        const { message } = exception
        log.error('generating enrollment session token failed:', { message, exception, user })
        res.status(400).json({ success: false, error: message })
      }
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
        const { disableFaceVerification, allowDuplicatedFaceRecords, claimQueueAllowed } = conf
        const enrollmentProcessor = createEnrollmentProcessor(storage)

        await enrollmentProcessor.validate(user, enrollmentIdentifier, payload)

        // if user is already verified, we're skipping enroillment logic
        if (user.isVerified || disableFaceVerification || allowDuplicatedFaceRecords || isE2ERunning) {
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
        } else {
          const isApprovedToClaim = ['approved', 'whitelisted'].includes(get(user, 'claimQueue.status'))

          // only approved users can do the process
          if (claimQueueAllowed > 0 && false === isApprovedToClaim) {
            throw new Error('User not approved to claim, not in queue or still pending')
          }

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
    wrapAsync(async (req, res, next) => {
      const { user, body } = req
      const log = req.log

      log.info('otp request:', { user, body })

      const mobile = body.user.mobile || user.otp.mobile
      const hashedMobile = sha3(mobile)
      let userRec: UserRecord = defaults(body.user, user, { identifier: user.loggedInAs })

      const savedMobile = user.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ mobile: hashedMobile }))) {
        return res.json({ ok: 0, error: 'mobile_already_exists' })
      }

      log.debug('sending otp:', user.loggedInAs)

      if (!userRec.smsValidated || hashedMobile !== savedMobile) {
        let code
        if (['production', 'staging'].includes(conf.env)) {
          code = await sendOTP({ mobile })
        }
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
      const hashedNewMobile = sha3(tempSavedMobile)
      const currentMobile = user.mobile

      log.debug('mobile verified', { user, verificationData })

      if (!user.smsValidated || currentMobile !== hashedNewMobile) {
        let verified = await verifier.verifyMobile({ identifier: user.loggedInAs }, verificationData).catch(e => {
          log.warn('mobile verification failed:', { e })

          res.json(400, { ok: 0, error: 'OTP FAILED', message: e.message })

          return false
        })

        if (verified === false) return

        let updIndexPromise
        if (currentMobile && currentMobile !== hashedNewMobile) {
          updIndexPromise = Promise.all([
            gunPublic.removeUserFromIndex('mobile', currentMobile),
            gunPublic.addUserToIndex('mobile', tempSavedMobile, user)
          ])
        }
        await Promise.all([
          updIndexPromise,
          user.mauticId && Mautic.updateContact(user.mauticId, { mobile: tempSavedMobile }),
          storage.updateUser({
            identifier: user.loggedInAs,
            smsValidated: true,
            mobile: hashedNewMobile
          }),
          storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.mobile': true } })
        ])
      }

      const signedMobile = await gunPublic.signClaim(user.profilePubkey, { hasMobile: tempSavedMobile })

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
    wrapAsync(async (req, res, next) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)
      const log = req.log

      const { user, body } = req
      const { email } = body.user

      //merge user details for use by mautic
      let userRec: UserRecord = defaults(body.user, user)
      const currentEmail = user.email
      const tempMauticId = user.otp && user.otp.tempMauticId

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ email }))) {
        return res.json({ ok: 0, error: 'Email already exists, please use a different one' })
      }

      let code
      if (runInEnv === true && conf.skipEmailVerification === false) {
        if ((!user.mauticId && !tempMauticId) || (currentEmail && currentEmail !== email)) {
          const mauticContact = await Mautic.createContact(userRec)

          //otp might be undefined so we use spread operator instead of userRec.otp.tempId=
          userRec.otp = {
            ...userRec.otp,
            tempMauticId: mauticContact.contact.id
          }
          log.debug('created new user mautic contact', userRec)
        }

        code = generateOTP(6)
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
      }

      // updates/adds user with the emailVerificationCode to be used for verification later and with mauticId
      await storage.updateUser({
        identifier: user.identifier,
        emailVerificationCode: code,
        otp: {
          ...userRec.otp,
          email
        }
      })

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
    wrapAsync(async (req, res, next) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)

      const log = req.log
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData
      const tempSavedEmail = user.otp && user.otp.email
      const hashedNewEmail = sha3(tempSavedEmail)
      const tempSavedMauticId = user.otp && user.otp.tempMauticId
      const currentEmail = user.email

      log.debug('email verified', { user, body, verificationData, tempSavedMauticId, tempSavedEmail, currentEmail })

      if (!user.isEmailConfirmed || currentEmail !== hashedNewEmail) {
        if (runInEnv && conf.skipEmailVerification === false)
          await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)

        const updateUserUbj = {
          identifier: user.loggedInAs,
          isEmailConfirmed: true,
          email: hashedNewEmail
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

        //update indexes, if new user, indexes are set in /adduser
        if (currentEmail && currentEmail !== tempSavedEmail) {
          gunPublic.removeUserFromIndex('email', currentEmail)
          gunPublic.addUserToIndex('email', tempSavedEmail, user)
        }
        const [, , signedEmail] = await Promise.all([
          storage.model.updateOne(
            { identifier: user.loggedInAs },
            { $unset: { 'otp.email': 1, 'otp.tempMauticId': 1 } }
          ),
          storage.updateUser(updateUserUbj),
          gunPublic.signClaim(req.user.profilePubkey, { hasEmail: hashedNewEmail })
        ])

        return res.json({ ok: 1, attestation: signedEmail })
      }

      return res.json({ ok: 0, error: 'nothing to do' })
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
        const mauticId = mauticContact.contact.id
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

      //we no longer hold user email so can't call updateW3Record outside signup
      //const w3Record = await addUserSteps.updateW3Record(user, logger) //make sure w3 registration was done
      // let loginToken = w3Record.loginToken
      let loginToken = user.loginToken

      //we no longer hold user email so can't call getLoginOrWalletToken outside signup
      // if (!loginToken) {
      //   const w3Data = await W3Helper.getLoginOrWalletToken(user)

      //   if (w3Data && w3Data.login_token) {
      //     loginToken = w3Data.login_token

      //     storage.updateUser({ ...user, loginToken })
      //   }
      // }

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

      /* we no longer hold user email, so we cant call getLoginOrWalletToken not in signup
      if (!wallet_token) {
        const w3Data = await W3Helper.getLoginOrWalletToken(currentUser)

        log.info('wallet token response data from w3 site', { w3Data })
        log.info('wallet token from w3 site', { walletToken: w3Data && w3Data.wallet_token })

        if (w3Data && w3Data.wallet_token) {
          wallet_token = w3Data.wallet_token

          storage.updateUser({ identifier: currentUser.loggedInAs, w3Token: w3Data.wallet_token })
        }
      }*/

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

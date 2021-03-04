// @flow

import { Router } from 'express'
import passport from 'passport'
import { get, defaults, pick } from 'lodash'
import { sha3 } from 'web3-utils'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import AdminWallet from '../blockchain/AdminWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import requestTimeout from '../utils/timeout'
// import fuseapi from '../utils/fuseapi'
import OTP from '../../imports/otp'
import conf from '../server.config'
import { Mautic } from '../mautic/mauticAPI'
import { sendTemplateEmail } from '../aws-ses/aws-ses'

import createEnrollmentProcessor from './processor/EnrollmentProcessor.js'
import { verifySignature } from '../utils/eth'

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
        const processor = createEnrollmentProcessor(storage, log)

        await verifySignature(enrollmentIdentifier, signature)
        await processor.enqueueDisposal(user, enrollmentIdentifier, log)
      } catch (exception) {
        const { message } = exception
        log.error('delete face record failed:', message, exception, { enrollmentIdentifier, user })
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
        const processor = createEnrollmentProcessor(storage, log)
        const isDisposing = await processor.isEnqueuedForDisposal(enrollmentIdentifier, log)

        res.json({ success: true, isDisposing })
      } catch (exception) {
        const { message } = exception
        log.error('face record disposing check failed:', message, exception, { enrollmentIdentifier, user })
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
        const processor = createEnrollmentProcessor(storage, log)
        const sessionToken = await processor.issueSessionToken(log)

        res.json({ success: true, sessionToken })
      } catch (exception) {
        const { message } = exception
        log.error('generating enrollment session token failed:', message, exception, { user })
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

      // checking if request aborted to handle cases when connection is slow
      // and facemap / images were uploaded more that 30sec causing timeout
      if (req.aborted) {
        return
      }

      try {
        const { disableFaceVerification, allowDuplicatedFaceRecords, claimQueueAllowed } = conf
        const enrollmentProcessor = createEnrollmentProcessor(storage, log)

        await enrollmentProcessor.validate(user, enrollmentIdentifier, payload)

        // if FV disabled or dups allowed or running Cypress, we're skipping enrollment logic
        if (disableFaceVerification || allowDuplicatedFaceRecords || isE2ERunning) {
          // creating enrollment session manually for this user
          const enrollmentSession = enrollmentProcessor.createEnrollmentSession(enrollmentIdentifier, user, log)

          // calling onEnrollmentStarted() to lock dispose task in the queue
          await enrollmentSession.onEnrollmentStarted()

          enrollmentResult = { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } }

          /*
            1. when FR is enabled and user is already verified,
              we need to make sure to whitelist him,
              maybe we changed the whitelisting contract and
              he is no longer whitelisted there,
              so we trust that we already whitelisted him in the past
              and whitelist him again in the new contract

            2. in the session's lifecycle onEnrollmentCompleted() is called
              after enrollment was successfull
              it whitelists user in the wallet and updates Gun's session
              here we're calling it manually as we've skipped enroll()
          */
          await enrollmentSession.onEnrollmentCompleted()
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

        log.error('Face verification error:', message, exception, { enrollmentIdentifier })
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

      const mobile = decodeURIComponent(body.user.mobile || user.otp.mobile) //fix in case input is %2B instead of +
      const hashedMobile = sha3(mobile)
      let userRec: UserRecord = defaults(body.user, user, { identifier: user.loggedInAs })

      const savedMobile = user.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ mobile: hashedMobile }))) {
        return res.json({ ok: 0, error: 'mobile_already_exists' })
      }

      log.debug('sending otp:', user.loggedInAs)

      if (!userRec.smsValidated || hashedMobile !== savedMobile) {
        if (['production', 'staging'].includes(conf.env)) {
          const sendResult = await OTP.sendOTP({ mobile }, { channel: body.user.otpChannel })

          log.debug('otp sent:', user.loggedInAs, sendResult)
        }

        await storage.updateUser({
          identifier: user.loggedInAs,
          otp: {
            ...(userRec.otp || {}),
            mobile
          }
        })
      }

      res.json({ ok: 1, alreadyVerified: hashedMobile === savedMobile && user.smsValidated })
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
      const { mobile } = user.otp || {}

      if (!mobile) {
        log.warn('mobile to verify not found or missing', 'mobile missing', new Error('mobile missing'), {
          user,
          verificationData
        })

        return res.status(400).json({ ok: 0, error: 'MOBILE MISSING' })
      }

      const hashedNewMobile = mobile && sha3(mobile)
      const currentMobile = user.mobile

      log.debug('mobile verified', { user, verificationData, hashedNewMobile })

      if (!user.smsValidated || currentMobile !== hashedNewMobile) {
        try {
          await verifier.verifyMobile({ identifier: user.loggedInAs, mobile }, verificationData)
        } catch (e) {
          log.warn('mobile verification failed:', e.message, { user, mobile, verificationData })
          return res.status(400).json({ ok: 0, error: 'OTP FAILED', message: e.message })
        }

        let updIndexPromise
        let updMauticPromise
        const { mauticId } = user

        if (currentMobile && currentMobile !== hashedNewMobile) {
          updIndexPromise = Promise.all([
            gunPublic.removeUserFromIndex('mobile', currentMobile),
            gunPublic.addUserToIndex('mobile', mobile, user)
          ])
        }

        if (mauticId) {
          updMauticPromise = Mautic.updateContact(mauticId, { mobile }, log).catch(e =>
            log.error('Error updating Mautic contact', e.message, e, { mauticId, mobile })
          )
        }

        await Promise.all([
          updIndexPromise,
          updMauticPromise,
          storage.updateUser({
            identifier: user.loggedInAs,
            smsValidated: true,
            mobile: hashedNewMobile
          }),
          user.createdDate && //keep temporary field if user is signing up
            storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.mobile': true } })
        ])
      }

      const signedMobile = await gunPublic.signClaim(user.profilePubkey, { hasMobile: mobile })

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
    requestRateLimiter(1, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log
      const user: LoggedUser = req.user

      //TODO: restore if necessary
      // check if user send ether out of the good dollar system
      // let isUserSendEtherOutOfSystem = false
      // try {
      //   const { result = [] } = await fuseapi.getTxList({
      //     address: user.gdAddress,
      //     page: 1,
      //     offset: 10,
      //     filterby: 'from'
      //   })
      //   isUserSendEtherOutOfSystem = result.some(r => Number(r.value) > 0)
      // } catch (e) {
      //   log.error('Check user transactions error', e.message, e)
      // }

      // if (isUserSendEtherOutOfSystem) {
      //   log.warn('User send ether out of system')

      //   return res.json({
      //     ok: 0,
      //     sendEtherOutOfSystem: true
      //   })
      // }

      log.debug('topwallet tx request:', { address: user.gdAddress })
      try {
        let txPromise = AdminWallet.topWallet(user.gdAddress, log)
          .then(tx => {
            log.debug('topwallet tx', { walletaddress: user.gdAddress, tx })
            return { ok: 1 }
          })
          .catch(async exception => {
            const { message } = exception
            log.error('Failed topwallet tx', message, exception, { walletaddress: user.gdAddress })

            return { ok: -1, error: message }
          })

        const txRes = await Promise.race([txPromise, requestTimeout(20000, 'topwallet tx timeout')])

        log.info('topwallet tx done', {
          txRes,
          loggedInAs: user.loggedInAs
        })
        res.json(txRes)
      } catch (e) {
        log.error('topwallet timeout or unexpected', e.message, e, { walletaddress: user.gdAddress })
        res.json({ ok: -1, error: e.message })
      }
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
    wrapAsync(async (req, res) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)
      const log = req.log

      const { user, body } = req
      const { email } = body.user

      //merge user details for use by mautic
      const { email: currentEmail } = user
      let userRec: UserRecord = defaults(body.user, user)
      const isEmailChanged = currentEmail && currentEmail !== sha3(email)

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ email }))) {
        log.debug('enforcing unique email per user', { email })
        return res.json({ ok: 0, error: 'Email already exists, please use a different one' })
      }

      let code
      log.debug('processing request for email verification', { email })
      if (runInEnv === true && conf.skipEmailVerification === false) {
        code = OTP.generateOTP(6)

        if (!user.isEmailConfirmed || isEmailChanged) {
          try {
            const { fullName } = userRec
            if (!code || !fullName || !email) {
              throw new Error('missing input for sending verification email')
            }
            const templateData = {
              firstname: fullName,
              code: parseInt(code)
            }
            await sendTemplateEmail(email, templateData)
            log.debug('sent new user email validation code', { email, code })
          } catch (e) {
            log.error('failed sending email verification to user:', e.message, e, { userRec, code })
            throw e
          }
        }
      }

      // updates/adds user with the emailVerificationCode to be used for verification later and with mauticId
      await storage.updateUser({
        identifier: user.identifier,
        emailVerificationCode: code,
        otp: {
          ...(userRec.otp || {}),
          email
        }
      })

      res.json({ ok: 1, alreadyVerified: isEmailChanged === false && user.isEmailConfirmed })
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
      const { email } = user.otp || {}
      const hashedNewEmail = sha3(email)
      const currentEmail = user.email

      log.debug('email verified', {
        user,
        body,
        email,
        verificationData,
        currentEmail
      })

      if (!user.isEmailConfirmed || currentEmail !== hashedNewEmail) {
        const { mauticId } = user

        if (runInEnv && conf.skipEmailVerification === false) {
          try {
            await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)
          } catch (e) {
            log.warn('email verification failed:', e.message, { user, email, verificationData })
            return res.status(400).json({ ok: 0, error: e.message })
          }
        }

        const updateUserUbj = {
          identifier: user.loggedInAs,
          isEmailConfirmed: true,
          email: hashedNewEmail
        }
        storage.updateUser(updateUserUbj)

        if (runInEnv) {
          //fire and forget updates (dont await)
          const exists = mauticId ? Mautic.contactExists(mauticId, log) : Promise.resolve(false)
          exists
            .then(async exists => {
              if (exists) {
                log.debug('mautic contact exists updating...')
                await Mautic.updateContact(mauticId, { email }, log)
              } else {
                log.debug('mautic contact doesnt exists creating...')

                const userFields = pick(user, [
                  'fullName',
                  'identifier',
                  'profilePublickey',
                  'regMethod',
                  'torusProvider'
                ])

                const nameParts = get(userFields, 'fullName', '').split(' ')
                const firstName = nameParts[0]
                const lastName = nameParts.length > 1 && nameParts.pop()

                const fieldsForMautic = {
                  firstName,
                  lastName,
                  ...userFields,
                  email
                }
                const record = await Mautic.createContact(fieldsForMautic, log)
                const newMauticId = get(record, 'contact.id', -1)
                updateUserUbj.mauticId = newMauticId
                await storage.model.updateOne(
                  { identifier: user.loggedInAs },
                  { $unset: { 'otp.email': 1, 'otp.tempMauticId': 1 }, $set: { mauticId: newMauticId } }
                )
              }
            })
            .catch(e =>
              log.error('Error updating Mautic contact', e.message, e, {
                currentEmail,
                mauticId,
                email
              })
            )
        }

        //update indexes, if new user, indexes are set in /adduser
        if (currentEmail && currentEmail !== email) {
          gunPublic.removeUserFromIndex('email', currentEmail)
          gunPublic.addUserToIndex('email', email, user)
        }

        const signedEmail = await gunPublic.signClaim(req.user.profilePubkey, { hasEmail: hashedNewEmail })

        return res.json({ ok: 1, attestation: signedEmail })
      }

      return res.json({ ok: 0, error: 'nothing to do' })
    })
  )

  /**
   * @api {get} /verify/phase get release/phase version number
   * @apiName Get Phase VErsion Number
   * @apiGroup Verification
   *
   * @apiSuccess {Number} phase
   * @apiSuccess {Boolean} success
   * @ignore
   */
  app.get('/verify/phase', (_, res) => {
    const { phase } = conf

    res.json({ success: true, phase })
    res.end()
  })
}

export default setup

// @flow

import { Router } from 'express'
import passport from 'passport'
import { get, defaults } from 'lodash'
import { sha3, toChecksumAddress } from 'web3-utils'
import requestIp from 'request-ip'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import { default as AdminWallet } from '../blockchain/MultiWallet'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import requestRateLimiter, { userRateLimiter } from '../utils/requestRateLimiter'
import OTP from '../../imports/otp'
import conf from '../server.config'
import OnGage from '../crm/ongage'
import { sendTemplateEmail } from '../aws-ses/aws-ses'
import fetch from 'cross-fetch'
import createEnrollmentProcessor from './processor/EnrollmentProcessor.js'
import { recoverPublickey } from '../utils/eth'
import { shouldLogVerificaitonError } from './utils/logger'
import { syncUserEmail } from '../storage/addUserSteps'
import { FV_IDENTIFIER_MSG2 } from '../login/login-middleware'

const verifyFVIdentifier = async (identifier, gdAddress) => {
  //check v2, v2 identifier is expected to be the whole signature
  if (identifier.length >= 42) {
    const signer = recoverPublickey(identifier, FV_IDENTIFIER_MSG2({ account: toChecksumAddress(gdAddress) }), '')

    if (signer.toLowerCase() !== gdAddress.toLowerCase()) {
      throw new Error(`identifier signer doesn't match user ${signer} != ${gdAddress}`)
    }
  }
}
const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
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
      const { gdAddress } = user
      const { fvSigner = '' } = query

      try {
        log.debug('delete face request:', { fvSigner, enrollmentIdentifier, user })
        const processor = createEnrollmentProcessor(storage, log)

        // for v2 identifier - verify that identifier is for the address we are going to whitelist
        await verifyFVIdentifier(enrollmentIdentifier, gdAddress)

        let v2Identifier = enrollmentIdentifier.slice(0, 42)
        let v1Identifier = fvSigner.replace('0x', '') // wallet will also supply the v1 identifier as fvSigner, we remove '0x' for public address

        // here we check if wallet was registered using v1 of v2 identifier
        const [isV2, isV1] = await Promise.all([
          processor.isIdentifierExists(v2Identifier),
          v1Identifier && processor.isIdentifierExists(v1Identifier)
        ])

        if (isV2) {
          //in v2 we expect the enrollmentidentifier to be the whole signature, so we cut it down to 42
          await processor.enqueueDisposal(user, v2Identifier, log)
        }

        if (isV1) {
          await processor.enqueueDisposal(user, v1Identifier, log)
        }
      } catch (exception) {
        const { message } = exception

        log.error('delete face record failed:', message, exception, { enrollmentIdentifier, fvSigner, user })
        res.status(400).json({ success: false, error: message })
        return
      }

      res.json({ success: true })
    })
  )

  /**
   * @api {get} /verify/face/:enrollmentIdentifier Checks is face snapshot enqueued for disposal. Return disposal state
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
      const { params, log, user, query } = req
      const { enrollmentIdentifier } = params
      const { fvSigner = '' } = query
      log.debug('check face status request:', { fvSigner, enrollmentIdentifier, user })

      try {
        let v2Identifier = enrollmentIdentifier.slice(0, 42)
        let v1Identifier = fvSigner.replace('0x', '') // wallet also provide older identifier in case it was created before v2

        const processor = createEnrollmentProcessor(storage, log)
        const [isDisposingV2, isDisposingV1] = await Promise.all([
          processor.isEnqueuedForDisposal(v2Identifier, log),
          v1Identifier && processor.isEnqueuedForDisposal(v1Identifier, log)
        ])

        res.json({ success: true, isDisposing: !!isDisposingV2 || !!isDisposingV1 })
      } catch (exception) {
        const { message } = exception

        log.error('face record disposing check failed:', message, exception, { enrollmentIdentifier, fvSigner, user })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {post} /verify/face/license Retrieves FaceTec license key for a new enrollment session
   * @apiName Retrieves FaceTec license key text
   * @apiGroup Verification
   *
   * @ignore
   */
  app.post(
    '/verify/face/license/:licenseType',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { log, user, params } = req
      const { licenseType } = params

      log.debug('license face request:', { licenseType, user })

      try {
        if (!conf.zoomProductionMode) {
          throw new Error('Cannot obtain production license running non-production mode.')
        }

        const processor = createEnrollmentProcessor(storage, log)
        const license = await processor.getLicenseKey(licenseType, log)

        res.json({ success: true, license })
      } catch (exception) {
        const { message } = exception
        log.error('getting FaceTec license failed:', message, exception, { user })
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

      log.debug('session face request:', { user })

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
      const { user, log, params, body } = req
      const { enrollmentIdentifier } = params
      const { chainId, fvSigner = '', ...payload } = body || {} // payload is the facetec data
      const { gdAddress } = user

      log.debug('enroll face request:', { fvSigner, enrollmentIdentifier, chainId, user })

      // checking if request aborted to handle cases when connection is slow
      // and facemap / images were uploaded more that 30sec causing timeout
      if (req.aborted) {
        return
      }

      user.chainId = chainId || conf.defaultWhitelistChainId

      try {
        // for v2 identifier - verify that identifier is for the address we are going to whitelist
        // for v1 this will do nothing
        await verifyFVIdentifier(enrollmentIdentifier, gdAddress)

        let v2Identifier = enrollmentIdentifier.slice(0, 42)
        let v1Identifier = fvSigner.replace('0x', '') // wallet will also supply the v1 identifier as fvSigner, we remove '0x' for public address

        const enrollmentProcessor = createEnrollmentProcessor(storage, log)

        // here we check if wallet was registered using v1 of v2 identifier
        const isV1 = !!v1Identifier && (await enrollmentProcessor.isIdentifierExists(v1Identifier))
        const activeIdentifier = isV1 ? v1Identifier : v2Identifier

        await enrollmentProcessor.validate(user, activeIdentifier, payload)

        const enrollmentResult = await enrollmentProcessor.enroll(user, activeIdentifier, payload, log)

        res.json(enrollmentResult)
      } catch (exception) {
        const { message } = exception
        const logArgs = ['Face verification error:', message, exception, { enrollmentIdentifier, fvSigner, gdAddress }]

        if (shouldLogVerificaitonError(exception)) {
          log.error(...logArgs)
        } else {
          log.warn(...logArgs)
        }

        res.status(400).json({ success: false, error: message })
      }
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
    userRateLimiter(1, 1), // 1 req / 1min, should be applied AFTER auth to have req.user been set
    // also no need for reqRateLimiter as user limiter falls back to the ip (e.g. works as default limiter if no user)
    wrapAsync(async (req, res) => {
      const { user, body } = req
      const log = req.log

      log.info('otp request:', { user, body })

      const onlyCheckAlreadyVerified = body.onlyCheckAlreadyVerified

      const mobile = decodeURIComponent(body.user.mobile || user.otp.mobile) //fix in case input is %2B instead of +
      const hashedMobile = sha3(mobile)
      let userRec: UserRecord = defaults(body.user, user, { identifier: user.loggedInAs })

      const savedMobile = user.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ mobile: hashedMobile }))) {
        return res.json({ ok: 0, error: 'mobile_already_exists' })
      }

      if (!userRec.smsValidated || hashedMobile !== savedMobile) {
        if (!onlyCheckAlreadyVerified) {
          log.debug('sending otp:', user.loggedInAs)
          if (['production', 'staging'].includes(conf.env)) {
            const clientIp = requestIp.getClientIp(req)
            const sendResult = await OTP.sendOTP(mobile, get(body, 'user.otpChannel', 'sms'), clientIp)

            log.info('otp sent:', mobile, { user: user.loggedInAs, sendResult })
          }

          await storage.updateUser({
            identifier: user.loggedInAs,
            otp: {
              ...(userRec.otp || {}),
              mobile
            }
          })
        }
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
    requestRateLimiter(),
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res) => {
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
          const clientIp = requestIp.getClientIp(req)
          await verifier.verifyMobile({ identifier: user.loggedInAs, mobile }, verificationData, clientIp)
        } catch (e) {
          log.warn('mobile verification failed:', e.message, { user, mobile, verificationData })
          return res.status(400).json({ ok: 0, error: 'OTP FAILED', message: e.message })
        }

        let updIndexPromise
        const { crmId } = user

        if (currentMobile && currentMobile !== hashedNewMobile) {
          updIndexPromise = Promise.all([
            //TODO: generate ceramic claim
          ])
        }

        if (crmId) {
          //fire and forget
          OnGage.updateContact(null, crmId, { mobile }, log).catch(e =>
            log.error('Error updating CRM contact', e.message, e, { crmId, mobile })
          )
        }

        await Promise.all([
          updIndexPromise,
          storage.updateUser({
            identifier: user.loggedInAs,
            smsValidated: true,
            mobile: hashedNewMobile
          }),
          user.createdDate && //keep temporary field if user is signing up
            storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.mobile': true } })
        ])
      }

      //TODO: replace with ceramic
      let signedMobile
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
    wrapAsync(async (req, res) => {
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
    requestRateLimiter(3, 1),
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { origin, host } = req.headers
      const { account, chainId } = req.body || {}
      const user: LoggedUser = req.user || { gdAddress: account }
      const clientIp = requestIp.getClientIp(req)

      log.debug('topwallet tx request:', { address: user.gdAddress, chainId, user: req.user, origin, host, clientIp })
      if (conf.env === 'production') {
        if (!origin.endsWith('wallet.gooddollar.org')) {
          const isWhitelisted = await AdminWallet.isVerified(user.gdAddress)
          if (!isWhitelisted) {
            log.info('topwallet denied, not whitelisted', { address: user.gdAddress, origin, chainId, clientIp })
            return res.json({ ok: -1, error: 'not whitelisted' })
          }
        }
      }
      if (!user.gdAddress) {
        throw new Error('missing wallet address to top')
      }

      try {
        let txPromise = AdminWallet.topWallet(user.gdAddress, chainId, log)
          .then(tx => {
            log.debug('topwallet tx', { walletaddress: user.gdAddress, tx })
            return { ok: 1 }
          })
          .catch(async exception => {
            const { message } = exception
            log.warn('Failed topwallet tx', message, exception, { walletaddress: user.gdAddress }) //errors are already logged in adminwallet so jsut warn

            return { ok: -1, error: message }
          })

        const txRes = await txPromise

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

      let { email } = body.user
      email = email.toLowerCase()

      if (!email || !user) {
        log.warn('email verification email or user record not found:', { email, user })
        return res.json({ ok: 0, error: 'email or user missing' })
      }

      //merge user details
      const { email: currentEmail } = user
      let userRec: UserRecord = defaults(body.user, user)
      const isEmailChanged = currentEmail && currentEmail !== sha3(email)

      let code
      log.debug('email verification request:', { email, currentEmail, isEmailChanged, body, user })

      if (runInEnv === true && conf.skipEmailVerification === false) {
        code = OTP.generateOTP(6)

        if (!user.isEmailConfirmed || isEmailChanged) {
          try {
            const { fullName } = userRec

            if (!code || !fullName || !email) {
              log.error('missing input for sending verification email', { code, fullName, email })
              throw new Error('missing input for sending verification email')
            }

            const templateData = {
              firstname: fullName,
              code: parseInt(code)
            }

            const sesResponse = await sendTemplateEmail(email, templateData)

            log.debug('sent new user email validation code', {
              email,
              code,
              sesResponse: get(sesResponse, '$response.httpResponse.statusCode'),
              sesId: get(sesResponse, 'MessageId'),
              sesError: get(sesResponse, '$response.error.message')
            })
          } catch (e) {
            log.error('failed sending email verification to user:', e.message, e, { userRec, code })
            throw e
          }
        }
      }

      // updates/adds user with the emailVerificationCode to be used for verification later
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
    wrapAsync(async (req, res) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)
      const { __utmzz: utmString = '' } = req.cookies
      const log = req.log
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData

      let { email } = user.otp || {}
      email = email && email.toLowerCase()

      const hashedNewEmail = email ? sha3(email) : null
      const currentEmail = user.email

      log.debug('email verification request', {
        user,
        body,
        email,
        verificationData,
        currentEmail,
        hashedNewEmail
      })

      if (!email) {
        log.error('email address to verify is missing')
        throw new Error('email address to verify is missing')
      }

      if (!user.isEmailConfirmed || currentEmail !== hashedNewEmail) {
        let signedEmail

        if (runInEnv && conf.skipEmailVerification === false) {
          try {
            await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)
          } catch (e) {
            log.warn('email verification failed:', e.message, { user, email, verificationData })
            return res.status(400).json({ ok: 0, error: e.message })
          }
        }

        storage.updateUser({
          identifier: user.loggedInAs,
          isEmailConfirmed: true,
          email: hashedNewEmail
        })

        if (runInEnv) {
          storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.email': 1 } })

          // fire and forget
          syncUserEmail(user, email, utmString, log).catch(e =>
            log.error('Error updating CRM contact', e.message, e, {
              crmId: user.crmId,
              currentEmail,
              email
            })
          )
        }

        //TODO: sign using ceramic did
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
  })

  /**
   * @depracated now using goodcfverify cloudflare worker
   * @api {post} /verify/recaptcha verify recaptcha token
   * @apiName Recaptcha
   * @apiGroup Verification
   *
   * @apiParam {string} token
   *
   * @apiSuccess {Number} ok
   * @ignore
   */

  const visitorsCounter = {}
  app.post(
    '/verify/recaptcha',
    requestRateLimiter(60, 10),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { payload: token = '', ipv6 = '', captchaType = '', fingerprint = {} } = req.body
      const clientIp = requestIp.getClientIp(req)
      const xForwardedFor = (req.headers || {})['x-forwarded-for']
      const { visitorId } = fingerprint
      let kvStorageIpKey = clientIp
      let parsedRes = {}

      try {
        if (ipv6 && ipv6 !== clientIp) {
          kvStorageIpKey = ipv6
        }
        let visitsCounter = 0
        if (visitorId) {
          visitsCounter = visitorsCounter[visitorId] || 0
          visitsCounter++
          visitorsCounter[visitorId] = visitsCounter
        }

        log.debug('Verifying recaptcha', {
          token: token.slice(0, 10),
          ipv6,
          clientIp,
          kvStorageIpKey,
          xForwardedFor,
          captchaType,
          visitorId,
          visitsCounter
        })

        //hcaptcha verify
        if (captchaType === 'hcaptcha') {
          if (!visitorId) {
            //we use fingerprint only for web with hcaptcha at the moment
            throw new Error('missing visitorId')
          }

          const recaptchaRes = await fetch('https://hcaptcha.com/siteverify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              secret: conf.hcaptchaSecretKey,
              response: token
            })
          })
          parsedRes = await recaptchaRes.json()
        } else {
          const url = `https://www.google.com/recaptcha/api/siteverify?secret=${conf.recaptchaSecretKey}&response=${token}&remoteip=${clientIp}`

          const recaptchaRes = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: '*/*'
            }
          })

          parsedRes = await recaptchaRes.json()
        }

        if (parsedRes.success) {
          const verifyResult = await OTP.verifyCaptcha(kvStorageIpKey)

          log.debug('Recaptcha verified', { verifyResult, parsedRes })

          res.json({ success: true })
        } else {
          throw new Error('user failed captcha')
        }
      } catch (exception) {
        const { message } = exception
        const logFunc = ['user failed captcha', 'missing visitorId'].includes(message) ? 'warn' : 'error'
        log[logFunc]('Recaptcha verification failed', message, exception, {
          clientIp,
          token: token.slice(0, 10),
          captchaType,
          parsedRes
        })
        res.status(400).json({ success: false, error: message })
      }
    })
  )
}

export default setup

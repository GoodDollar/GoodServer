// @flow
import moment from 'moment'
import { Router } from 'express'
import passport from 'passport'
import fetch from 'cross-fetch'
import { first, get, toLower, values } from 'lodash'
import { sha3, toChecksumAddress } from 'web3-utils'

import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { withTimeout } from '../utils/async'
import OnGage from '../crm/ongage'
import conf from '../server.config'
import { addUserToWhiteList, createCRMRecord } from './addUserSteps'
import createUserVerifier from './verifier'
import stakingModelTasks from '../blockchain/stakingModelTasks'
import { cancelDisposalTask, getDisposalTask } from '../verification/cron/taskUtil'
import createEnrollmentProcessor from '../verification/processor/EnrollmentProcessor'
import requestRateLimiter from '../utils/requestRateLimiter'
import { default as AdminWallet } from '../blockchain/MultiWallet'
import Logger from '../../imports/logger'

const { fishManager } = stakingModelTasks

const deleteFromAnalytics = (userId, walletAddress, log) => {
  const amplitudePromise = fetch(`https://amplitude.com/api/2/deletions/users`, {
    headers: { Authorization: `Basic ${conf.amplitudeBasicAuth}`, 'Content-Type': 'application/json' },
    method: 'POST',

    body: JSON.stringify({
      user_ids: [toChecksumAddress(userId.toLowerCase())], //amplitude id is case sensitive and is the original address form from user wallet
      delete_from_org: 'True',
      ignore_invalid_id: 'True'
    })
  })
    .then(_ => _.text())
    .then(_ => {
      log.info('amplitude delete user result', { result: _ })
      return {
        amplitude: 'ok'
      }
    })
    .catch(() => ({ amplitude: 'failed' }))

  return [amplitudePromise]
}

const adminAuthenticate = (req, res, next) => {
  const { password } = req.body || {}

  if (password !== conf.adminPassword) {
    return res.json({ ok: 0 })
  }

  next()
}

const setup = (app: Router, storage: StorageAPI) => {
  app.use(
    ['/user/*'],
    passport.authenticate('jwt', { session: false }),
    requestRateLimiter(20, 1, 'user'),
    wrapAsync(async (req, res, next) => {
      const { user, body, log } = req
      const { loggedInAs } = user
      const identifier = get(body, 'user.identifier', loggedInAs)

      log.trace(`/user/* ${req.baseUrl} auth:`, { user, body })

      if (loggedInAs !== identifier) {
        log.warn(`Trying to update other user data! ${loggedInAs}!==${identifier}`)
        throw new Error(`Trying to update other user data! ${loggedInAs}!==${identifier}`)
      } else next()
    })
  )

  /**
   * @api {post} /user/add Add user account
   * @apiName Add
   * @apiGroup Storage
   *
   * @apiParam {Object} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/user/add',
    wrapAsync(async (req, res) => {
      const { env, skipEmailVerification, disableFaceVerification, optionalMobile } = conf
      const isNonDevelopMode = env !== 'development'
      const { cookies, body, log: logger, user: userRecord } = req
      const { user: userPayload = {} } = body
      const { __utmzz: utmString = '' } = cookies

      try {
        logger.debug('new user request:', { data: userPayload, userRecord })
        let { email } = userPayload
        email = email.toLowerCase()

        const { mobile, inviteCode, fullName, regMethod, torusProvider } = userPayload

        // if torus, then we first verify the user mobile/email by verifying it matches the torus public key
        // (torus maps identifier such as email and mobile to private/public key pairs)
        const verifier = createUserVerifier(userRecord, userPayload, logger)

        //this modifies userRecord with smsValidated/isEmailConfirmed
        const { emailVerified, mobileVerified } = await verifier.verifySignInIdentifiers()

        const isEmailTorusVerified = email && emailVerified
        const isEmailManuallyVerified = email && userRecord.isEmailConfirmed && userRecord.email === sha3(email)
        const isEmailConfirmed = !!('development' === env || isEmailTorusVerified || isEmailManuallyVerified)
        const isMobileTorusVerified = mobile && mobileVerified
        const isMobileManuallyVerified = mobile && userRecord.smsValidated && userRecord.mobile === sha3(mobile)
        const isMobileConfirmed = !!('development' === env || isMobileTorusVerified || isMobileManuallyVerified)

        logger.debug('new user verification result:', {
          env,
          mobile,
          email,
          isEmailTorusVerified,
          isEmailManuallyVerified,
          isMobileTorusVerified,
          isMobileManuallyVerified,
          isEmailConfirmed,
          isMobileConfirmed
        })
        // check that user email/mobile sent is the same as the ones verified
        //in case email/mobile was verified using torus userRecord.mobile/email will be empty
        if (['production', 'staging'].includes(env)) {
          if (optionalMobile === false && isMobileConfirmed === false) {
            throw new Error('User mobile not verified!')
          }

          if (skipEmailVerification === false && isEmailConfirmed === false) {
            throw new Error('User email not verified!')
          }
        }

        userRecord.isEmailConfirmed = isEmailConfirmed
        userRecord.smsValidated = isMobileConfirmed

        if (userRecord.createdDate) {
          logger.warn('user already created', { userRecord, userPayload })
          // return res.json({ ok: 1 })
        }

        const toUpdateUser: UserRecord = {
          identifier: userRecord.loggedInAs,
          regMethod,
          torusProvider,
          email: email ? sha3(email) : userRecord.email,
          mobile: mobile ? sha3(mobile) : userRecord.mobile,
          fullName,
          profilePublickey: userRecord.profilePublickey,
          walletAddress: sha3(userRecord.gdAddress.toLowerCase()),
          isCompleted: userRecord.isCompleted
            ? userRecord.isCompleted
            : {
                whiteList: false,
                topWallet: false
              },
          isEmailConfirmed,
          smsValidated: isMobileConfirmed
        }

        const userRecordWithPII = { ...userRecord, ...toUpdateUser, inviteCode, email, mobile }
        const signUpPromises = []

        const p1 = storage
          .updateUser(toUpdateUser)
          .then(() => logger.debug('updated new user record', { toUpdateUser }))
          .catch(e => {
            logger.error('failed updating new user record', e.message, e, { toUpdateUser })
            throw e
          })
        signUpPromises.push(p1)

        // whitelisting user if FR is disabled
        if (disableFaceVerification) {
          const p2 = addUserToWhiteList(userRecord, logger)
            .then(isWhitelisted => {
              logger.debug('addUserToWhiteList result', { isWhitelisted })
              if (isWhitelisted === false) throw new Error('Failed whitelisting user')
            })
            .catch(e => {
              logger.warn('addUserToWhiteList failed', e.message, e, { userRecord })
              throw e
            })
          signUpPromises.push(p2)
        }

        let p3 = Promise.resolve()
        if (isNonDevelopMode) {
          p3 = createCRMRecord(userRecordWithPII, utmString, logger)
            .then(r => {
              logger.debug('createCRMRecord success')
              return r
            })
            .catch(e => {
              logger.error('createCRMRecord failed', e.message, e, { userRecordWithPII })
              throw new Error('Failed adding user to CRM')
            })
          signUpPromises.push(p3)
        }

        const p5 = Promise.all([
          //TODO: generate email/mobile claims using ceramic
        ])
          .then(res => logger.info('created did claims: result', { res }))
          .catch(() => {
            logger.warn('create did claims: failed')
          })

        signUpPromises.push(p5)

        // don't await, if we failed to update its not critical for user.
        withTimeout(Promise.all(signUpPromises), 30000, 'signup promises timeout')
          .then(async () => {
            logger.info('signup promises success')
            if (isNonDevelopMode) {
              const crmId = await p3
              if (crmId)
                await OnGage.updateContact(email, crmId, { signup_completed: true }, logger).catch(exception => {
                  const { message } = exception
                  logger.error('Failed CRM tagging user completed signup', message, exception, { crmId })
                })
            }
          })
          .catch(e => logger.error('signup promises failed', e.message, e))

        logger.debug('signup steps success. adding new user:', { toUpdateUser })

        await storage.updateUser({
          identifier: userRecord.loggedInAs,
          createdDate: userRecord.createdDate || new Date().toString(),
          otp: {} //delete trace of mobile,email
        })

        res.json({ ok: 1 })
      } catch (e) {
        logger.warn('user signup failed', e.message, e)
        throw e
      }
    })
  )

  /**
   * we had issues with mautic some users are not in the database
   * fix to make sure we have user data in CRM
   */
  app.post(
    '/user/verifyCRM',
    wrapAsync(async (req, res) => {
      const { body, log: logger, user: userRecord } = req
      const { user: userPayload = {} } = body

      try {
        logger.debug('verify crm:', { data: userPayload, userRecord })

        if (userRecord.crmId) {
          logger.debug('verifyCRM already has crmID', { crmId: userRecord.crmId })
        } else {
          let { email, mobile, fullName } = userPayload

          if (!email) {
            const error = 'verifyCRM missing user email'

            logger.warn(error, { userPayload, userRecord })
            return res.json({ ok: 0, error })
          }

          let emailLC = email.toLowerCase()

          const toCRM = {
            identifier: userRecord.loggedInAs,
            fullName,
            walletAddress: sha3(userRecord.gdAddress.toLowerCase()),
            email
          }

          // TODO: verify why this is happening on wallet
          // for some reason some emails were kept with capital letter while from user they arrive lower case
          // this line is a patch to handle that case

          if (
            (sha3(email) === userRecord.email ||
              sha3(emailLC) === userRecord.email ||
              sha3(emailLC.charAt(0).toUpperCase() + emailLC.slice(1)) === userRecord.email) === false
          ) {
            logger.error('unable to verify user email', { email, hash: sha3(email), recordHash: userRecord.email })
          }

          if (mobile && sha3(mobile) === userRecord.mobile) {
            toCRM.mobile = mobile
          }

          const crmId = await createCRMRecord(toCRM, '', logger)

          await storage.updateUser({
            email: sha3(email),
            identifier: userRecord.loggedInAs,
            crmId
          })

          logger.debug('verifyCRM success', { crmId, toCRM })
        }

        res.json({ ok: 1 })
      } catch (e) {
        logger.error('createCRMRecord failed', e.message, e)
        throw new Error('Failed adding user in verifyCRM')
      }
    })
  )

  /**
   * @api {post} /user/start user starts registration and we have his email
   * @apiName Add
   * @apiGroup Storage
   *
   * @apiParam {Object} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/user/start',
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res) => {
      const { user } = req.body
      const { log: logger, user: existingUser } = req
      const { __utmzz: utmString = '' } = req.cookies

      if (existingUser.crmId) {
        return res.json({ ok: 1 })
      }

      if (!user.email) {
        logger.error('email missing', { user, existingUser })
        throw new Error('Email is missed')
      }

      // fire and forget, don't wait for success or failure
      createCRMRecord({ ...user, email: user.email.toLowerCase() }, utmString, logger)
        .then(() => logger.debug('/user/start createCRMRecord success'))
        .catch(e => {
          logger.error('/user/start createCRMRecord failed', e.message, e, { user })
        })

      res.json({ ok: 1 })
    })
  )

  /**
   * @api {post} /user/claim collect claim status to crm
   * @apiName Add
   * @apiGroup Storage
   *
   * @apiParam {Object} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  let updatesQueue = [] // we send updates to ongange in bulk
  const qLogger = Logger.child({ from: 'OnGageQueue' })
  const clearOnGageQueue = async () => {
    if (updatesQueue.length === 0) return
    const oldQueue = updatesQueue
    updatesQueue = []
    try {
      const result = await OnGage.updateContacts(oldQueue, qLogger)
      qLogger.debug('/user/claim updateContacts result:', { result, total: oldQueue.length })
    } catch (e) {
      qLogger.error('/user/claim updateContacts failed', e.message, e, { oldQueue })
    }
  }
  if (conf.env !== 'test') setInterval(clearOnGageQueue, 60 * 1000)

  app.post(
    '/user/claim',
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res) => {
      let { last_claim, claim_counter } = req.body
      const { log: logger, user } = req

      if (!user.crmId) {
        const error = 'user/claim missing crmId'

        logger.warn(error, { user, body: req.body })
        res.json({ ok: 0, error })
        return
      }

      // format date according to OnGage date format
      last_claim = moment().format('YYYY/MM/DD')

      updatesQueue.push({ id: user.crmId, last_claim, claim_counter })
      if (updatesQueue.length > 100) {
        clearOnGageQueue()
      }

      res.json({ ok: 1 })
    })
  )

  /**
   * @api {post} /user/delete Delete user account
   * @apiName Delete
   * @apiGroup Storage
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {[Object]} results
   * @ignore
   */
  app.post(
    '/user/delete',
    wrapAsync(async (req, res) => {
      const { user, log } = req
      log.info('delete user', { user })

      //first get number of accounts using same crmId before we delete the account
      const crmCount = user.crmId
        ? await storage.getCountCRMId(user.crmId).catch(e => {
            log.warn('getCountCRMId failed:', e.message, e)
            return 1
          })
        : 0

      const results = await Promise.all([
        (user.identifier ? storage.deleteUser(user) : Promise.reject())
          .then(() => ({ mongodb: 'ok' }))
          .catch(() => ({ mongodb: 'failed' })),
        crmCount > 1
          ? Promise.resolve({ crm: 'okMultiNotDeleted' })
          : crmCount === 0
            ? Promise.resolve({ crm: 'missingId' })
            : OnGage.deleteContact(user.crmId, log)
                .then(() => ({ crm: 'ok' }))
                .catch(() => ({ crm: 'failed' })),
        ...deleteFromAnalytics(user.identifier, user.gdAddress)
      ])

      log.info('delete user results', { user, results })
      res.json({ ok: 1, results })
    })
  )

  /**
   * @api {get} /user/exists return true  if user finished registration
   * @apiName Delete
   * @apiGroup Storage
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Boolean} exists
   * @apiSuccess {String} fullName

   * @ignore
   */
  app.get(
    '/user/exists',
    wrapAsync(async (req, res) => {
      const { user } = req

      res.json({ ok: 1, exists: user.createdDate != null, fullName: user.fullName })
    })
  )

  /**
   * @api {post} /userExists returns user registration method
   * @apiGroup Storage
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Boolean} exists
   * @apiSuccess {String} fullName
   * @apiSuccess {String} provider


   * @ignore
   */
  app.post(
    '/userExists',
    wrapAsync(async (req, res) => {
      const { log, body } = req
      const toHash = value => (value ? sha3(value) : null)
      const sendNotExists = () => res.json({ ok: 1, exists: false })

      let { identifier = '', email, mobile } = body
      email = email ? email.toLowerCase() : undefined

      const lowerCaseID = identifier ? identifier.toLowerCase() : undefined
      const [emailHash, mobileHash] = [email, mobile].map(toHash)

      const identityFilters = [
        // identifier is stored lowercase in the db. we lowercase addresses in the /auth/eth process
        { identifier: lowerCaseID },
        { email: email && emailHash },
        { mobile: mobile && mobileHash }
      ].filter(or => !!first(values(or)))

      if (identityFilters.length === 0) {
        log.warn('empty data for /userExists', { body })
        sendNotExists()

        return
      }

      const dateFilters = {
        createdDate: { $exists: true }
      }

      const providerFilters = [
        { regMethod: { $type: 'string', $ne: 'torus' } },
        { regMethod: 'torus', torusProvider: { $type: 'string', $ne: '' } }
      ]

      const searchFilters = [identityFilters, providerFilters].map(filters => ({ $or: filters }))

      const allFilters = {
        $and: [dateFilters, ...searchFilters]
      }

      const projections = {
        identifier: 1,
        email: 1,
        mobile: 1,
        createdDate: 1,
        torusProvider: 1,
        fullName: 1,
        regMethod: 1,
        crmId: 1
      }

      // sort by importance, prefer oldest verified account
      let ordering = { isVerified: -1, createdDate: 1 }

      if (lowerCaseID) {
        // sortBy sorts in ascending order (and keeps existing sort)
        // so non-matched by id results would be moved to the end
        projections.identifierMatches = {
          $eq: ['$identifier', lowerCaseID]
        }

        ordering = { identifierMatches: -1, ...ordering }
      }

      const existing = await storage.model.aggregate([
        { $match: allFilters },
        { $project: projections },
        { $sort: ordering }
      ])

      log.debug('userExists:', { existing, identifier, identifierLC: lowerCaseID, email, mobile })

      if (!existing.length) {
        return sendNotExists()
      }

      const bestExisting = first(existing)

      return res.json({
        ok: 1,
        exists: true,
        found: existing.length,
        fullName: bestExisting.fullName,
        provider: bestExisting.torusProvider,
        identifier: bestExisting.identifierMatches,
        email: email && emailHash === bestExisting.email,
        mobile: mobile && mobileHash === bestExisting.mobile,
        regMethod: bestExisting.regMethod
      })
    })
  )

  app.get(
    '/userWhitelisted/:account',
    requestRateLimiter(10, 1),
    wrapAsync(async (req, res) => {
      const { params } = req
      const { account } = params
      const isWhitelisted = await AdminWallet.isVerified(account)

      res.json({ ok: 1, isWhitelisted })
    })
  )

  app.get(
    '/syncWhitelist/:account',
    requestRateLimiter(3, 1),
    wrapAsync(async (req, res) => {
      const { params, log } = req
      const { account } = params

      try {
        const whitelisted = await AdminWallet.syncWhitelist(account, log)

        log.debug('syncWhitelist success', { account, whitelisted })
        res.json({ ok: 1, whitelisted })
      } catch (e) {
        log.error('failed syncWhitelist', e.message, e, { account })
        res.json({ ok: 0, error: e.message })
      }
    })
  )

  app.post(
    '/admin/user/get',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body } = req
      let user = {}
      if (body.email)
        user = await storage.getUsersByEmail(body.email.startsWith('0x') === false ? sha3(body.email) : body.email)
      if (body.mobile)
        user = await storage.getUsersByMobile(body.mobile.startsWith('0x') === false ? sha3(body.mobile) : body.mobile)
      if (body.identifier) user = await storage.getUser(body.identifier)
      if (body.identifierHash) user = await storage.getByIdentifierHash(body.identifierHash)

      res.json({ ok: 1, user })
    })
  )

  app.post(
    '/admin/user/list',
    adminAuthenticate,
    wrapAsync(async (_, res) => storage.listUsers(list => res.json(list)))
  )

  app.post(
    '/admin/user/delete',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body } = req
      let result = {}
      if (body.identifier) result = await storage.deleteUser(body)

      res.json({ ok: 1, result })
    })
  )

  app.post(
    '/admin/model/fish',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { daysAgo } = body
      if (!daysAgo) return res.json({ ok: 0, error: 'missing daysAgo' })
      log.debug('fishing request', { daysAgo })
      fishManager
        .run(daysAgo)
        .then(fishResult => log.info('fishing request result:', { fishResult }))
        .catch(e => log.error('fish request failed', e.message, e, { daysAgo }))

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/admin/verify/face/delete',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { enrollmentIdentifier, walletAddress } = body

      try {
        let removeWhitelistedResult
        if (walletAddress) {
          removeWhitelistedResult = await AdminWallet.removeWhitelisted(walletAddress)
        }

        log.info('admin delete faceid', { enrollmentIdentifier, walletAddress, removeWhitelistedResult })
        const processor = createEnrollmentProcessor(storage, log)

        await processor.dispose(toLower(enrollmentIdentifier), log)
        await cancelDisposalTask(storage, enrollmentIdentifier)
      } catch (exception) {
        const { message } = exception

        log.error('delete face record failed:', message, exception, { enrollmentIdentifier })
        res.status(400).json({ ok: 0, error: message })
        return
      }

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/admin/verify/face/disposal',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { enrollmentIdentifier } = body

      try {
        const record = await getDisposalTask(storage, enrollmentIdentifier)
        log.debug('get face disposal task result:', { enrollmentIdentifier, record })
        return res.json({ ok: 1, record })
      } catch (exception) {
        const { message } = exception
        log.error('get face disposal task failed:', message, exception, { enrollmentIdentifier })
        res.status(400).json({ ok: 0, error: message })
        return
      }
    })
  )

  app.post(
    '/admin/user/verifyAge',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body, log } = req
      let result = {}
      if (body.identifier) result = await storage.updateUser({ identifier: body.identifier, ageVerified: true })
      log.info('admin age verify', body.identifier, result)
      res.json({ ok: 1, result })
    })
  )
}

export default setup

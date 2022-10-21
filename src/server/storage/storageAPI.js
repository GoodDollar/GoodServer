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
import { cancelDisposalTask } from '../verification/cron/taskUtil'
import createEnrollmentProcessor from '../verification/processor/EnrollmentProcessor'
import requestRateLimiter from '../utils/requestRateLimiter'
import { default as AdminWallet } from '../blockchain/MultiWallet'

const { fishManager } = stakingModelTasks
const { faceVerificationDebugTool } = conf

const adminAuthenticate = (req, res, next) => {
  const { body } = req
  if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
  next()
}

const setup = (app: Router, storage: StorageAPI) => {
  app.use(
    ['/user/*'],
    passport.authenticate('jwt', { session: false }),
    requestRateLimiter(20, 1),
    wrapAsync(async (req, res, next) => {
      const { user, body, log } = req
      const { loggedInAs } = user
      const identifier = get(body, 'user.identifier', loggedInAs)

      log.debug(`${req.baseUrl} auth:`, { user, body })

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
      const isNonDevelopMode = process.env.NODE_ENV !== 'development'
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

          email = email.toLowerCase()

          const toCRM = {
            identifier: userRecord.loggedInAs,
            fullName,
            walletAddress: sha3(userRecord.gdAddress.toLowerCase())
          }

          if (email && sha3(email) === userRecord.email) {
            toCRM.email = email
          }

          // TODO: verify why this is happening on wallet
          // for some reason some emails were kept with capital letter while from user they arrive lower case
          // this line is a patch to handle that case
          if (email && sha3(email.charAt(0).toUpperCase() + email.slice(1)) === userRecord.email) {
            toCRM.email = email
          }

          if (mobile && sha3(mobile) === userRecord.mobile) {
            toCRM.mobile = mobile
          }

          const crmId = await createCRMRecord(toCRM, '', logger)

          await storage.updateUser({
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
      last_claim = moment(last_claim).format('YYYY/MM/DD')

      await OnGage.updateContact(null, user.crmId, { last_claim, claim_counter }, logger)
        .then(() => logger.debug('/user/claim updateContact success'))
        .catch(e => {
          logger.error('/user/claim updateContact failed', e.message, e, { user, body: req.body })
          throw new Error('Failed updating user claim in CRM')
        })

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
          : OnGage.deleteContact(user.crmId)
              .then(() => ({ crm: 'ok' }))
              .catch(() => ({ crm: 'failed' })),
        fetch(`https://api.fullstory.com/users/v1/individual/${user.identifier}`, {
          headers: { Authorization: `Basic ${conf.fullStoryKey}` },
          method: 'DELETE'
        })
          .then(() => ({ fs: 'ok' }))
          .catch(() => ({ fs: 'failed' })),
        fetch(`https://amplitude.com/api/2/deletions/users`, {
          headers: { Authorization: `Basic ${conf.amplitudeBasicAuth}`, 'Content-Type': 'application/json' },
          method: 'POST',

          body: JSON.stringify({
            user_ids: [toChecksumAddress(user.identifier.toLowerCase())], //amplitude id is case sensitive and is the original address form from user wallet
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
    requestRateLimiter(1, 1),
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
      if (body.email) user = await storage.getUsersByEmail(sha3(body.email))
      if (body.mobile) user = await storage.getUsersByMobile(sha3(body.mobile))
      if (body.identifier) user = await storage.getUser(body.identifier)

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

  if (true !== faceVerificationDebugTool) {
    return
  }

  app.post(
    '/admin/verify/face/delete',
    adminAuthenticate,
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { enrollmentIdentifier } = body

      try {
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
}

export default setup

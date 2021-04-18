// @flow
import { Router } from 'express'
import passport from 'passport'
import fetch from 'cross-fetch'
import { defaults, first, get, omitBy, sortBy } from 'lodash'
import { sha3, toChecksumAddress } from 'web3-utils'

import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { withTimeout } from '../utils/timeout'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import addUserSteps from './addUserSteps'
import createUserVerifier from './verifier'
import { fishManager } from '../blockchain/stakingModelTasks'
import { DBUpdateTask } from '../db/cron/dbUpdateTask'

const adminAuthenticate = (req, res, next) => {
  const { body } = req
  if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
  next()
}

const setup = (app: Router, gunPublic: StorageAPI, storage: StorageAPI) => {
  app.use(
    ['/user/*'],
    passport.authenticate('jwt', { session: false }),
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
      const {
        env,
        skipEmailVerification,
        disableFaceVerification,
        mauticBasicToken,
        mauticToken,
        optionalMobile
      } = conf
      const isNonDevelopMode = process.env.NODE_ENV !== 'development'
      const { cookies, body, log: logger, user: userRecord } = req
      const { user: userPayload = {} } = body
      const { __utmzz: utmString = '' } = cookies

      try {
        logger.debug('new user request:', { data: userPayload, userRecord })

        const { email, mobile, inviteCode, ...restPayload } = userPayload

        // if torus, then we first verify the user mobile/email by verifying it matches the torus public key
        // (torus maps identifier such as email and mobile to private/public key pairs)
        const verifier = createUserVerifier(userRecord, userPayload, logger)

        //this modifies userRecord with smsValidated/isEmailConfirmed
        const { emailVerified, mobileVerified } = await verifier.verifySignInIdentifiers()

        const isEmailTorusVerified = email && emailVerified
        const isEmailManuallyVerified = email && userRecord.isEmailConfirmed && userRecord.email === sha3(email)
        const isEmailConfirmed = 'development' === env || isEmailTorusVerified || isEmailManuallyVerified
        const isMobileTorusVerified = mobile && mobileVerified
        const isMobileManuallyVerified = mobile && userRecord.smsValidated && userRecord.mobile === sha3(mobile)
        const isMobileConfirmed = 'development' === env || isMobileTorusVerified || isMobileManuallyVerified

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
          return res.json({ ok: 1 })
        }

        // removing creds, nonce, proof and crypto keys from user payload as they shouldn't be stored in the userRecord
        const payloadWithoutCreds = omitBy(restPayload, (_, userProperty) => userProperty.startsWith('torus'))

        const toUpdateUser: UserRecord = defaults(payloadWithoutCreds, {
          identifier: userRecord.loggedInAs,
          regMethod: userPayload.regMethod,
          torusProvider: userPayload.torusProvider,
          email: email ? sha3(email) : userRecord.email,
          mobile: mobile ? sha3(mobile) : userRecord.mobile,
          walletAddress: sha3(userRecord.gdAddress.toLowerCase()),
          mobileValidated: !!userRecord.smsValidated,
          profilePublickey: userRecord.profilePublickey,
          isCompleted: userRecord.isCompleted
            ? userRecord.isCompleted
            : {
                whiteList: false,
                topWallet: false
              },
          isEmailConfirmed,
          smsValidated: isMobileConfirmed
        })

        const userRecordWithPII = { ...payloadWithoutCreds, ...userRecord, inviteCode, email, mobile }
        const signUpPromises = []

        const p1 = storage
          .updateUser(toUpdateUser)
          .then(r => logger.debug('updated new user record', { toUpdateUser }))
          .catch(e => {
            logger.error('failed updating new user record', e.message, e, { toUpdateUser })
            throw e
          })
        signUpPromises.push(p1)

        // whitelisting user if FR is disabled
        if (disableFaceVerification) {
          const p2 = addUserSteps
            .addUserToWhiteList(userRecord, logger)
            .then(isWhitelisted => {
              logger.debug('addUserToWhiteList result', { isWhitelisted })
              if (isWhitelisted === false) throw new Error('Failed whitelisting user')
            })
            .catch(e => {
              logger.error('addUserToWhiteList failed', e.message, e, { userRecord })
              throw e
            })
          signUpPromises.push(p2)
        }

        let p3 = Promise.resolve()
        if (isNonDevelopMode || mauticBasicToken || mauticToken) {
          p3 = addUserSteps
            .updateMauticRecord(userRecordWithPII, utmString, logger)
            .then(r => {
              logger.debug('updateMauticRecord success')
              return r
            })
            .catch(e => {
              logger.error('updateMauticRecord failed', e.message, e, { userRecordWithPII })
              throw new Error('Failed adding user to mautic')
            })
          signUpPromises.push(p3)
        }

        //no need to topwallet, we now have the faucet contract
        // const p4 = addUserSteps
        //   .topUserWallet(userRecord, logger)
        //   .then(isTopWallet => {
        //     if (isTopWallet === false) throw new Error('Failed to top wallet of new user')
        //     logger.debug('topUserWallet success')
        //   })
        //   .catch(e => {
        //     logger.error('topUserWallet failed', e.message, e, { userRecord })
        //     throw new Error('Failed topping user wallet')
        //   })
        // signUpPromises.push(p4)

        const p5 = Promise.all([
          userRecordWithPII.smsValidated &&
            userRecordWithPII.mobile &&
            gunPublic.addUserToIndex('mobile', userRecordWithPII.mobile, userRecordWithPII),
          userRecordWithPII.email &&
            userRecordWithPII.isEmailConfirmed &&
            gunPublic.addUserToIndex('email', userRecordWithPII.email, userRecordWithPII),
          userRecordWithPII.gdAddress &&
            gunPublic.addUserToIndex('walletAddress', userRecordWithPII.gdAddress.toLowerCase(), userRecordWithPII)
        ])
          .then(res => logger.info('updated trust indexes result:', { res }))
          .catch(e => {
            logger.error('updated trust indexes: failed adding new user to indexes. allowing to finish registration')
          })

        const p6 = withTimeout(p5, 15000, 'updated trust indexes timeout').catch(e => {
          logger.error(e.message)
        })

        signUpPromises.push(p6)

        // don't await, if we failed to update its not critical for user.
        withTimeout(Promise.all(signUpPromises), 30000, 'signup promises timeout')
          .then(async r => {
            logger.info('signup promises success')
            if (isNonDevelopMode || mauticBasicToken || mauticToken) {
              const mauticId = await p3
              await Mautic.updateContact(mauticId, { tags: ['signup_completed'] }, logger).catch(exception => {
                const { message } = exception
                logger.error('Failed Mautic tagging user completed signup', message, exception, { mauticId })
              })
            }
          })
          .catch(e => logger.error('signup promises failed', e.message, e))
        logger.debug('signup steps success. adding new user:', { toUpdateUser })

        await storage.updateUser({
          identifier: userRecord.loggedInAs,
          createdDate: new Date().toString(),
          otp: {} //delete trace of mobile,email
        })

        res.json({
          ok: 1
        })
      } catch (e) {
        logger.warn('user signup failed', e.message, e)
        throw e
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

      if (!user.email || existingUser.createdDate || existingUser.mauticId) return res.json({ ok: 0 })

      //fire and forget, don't wait for success or failure
      addUserSteps
        .updateMauticRecord(user, utmString, logger)
        .then(r => logger.debug('/user/start updateMauticRecord success'))
        .catch(e => {
          logger.error('/user/start updateMauticRecord failed', e.message, e, { user })
          throw new Error('Failed adding user to mautic')
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
    wrapAsync(async (req, res, next) => {
      const { user, log } = req
      log.info('delete user', { user })

      //first get number of accounts using same mauticId before we delete the account
      const mauticCount = await storage.getCountMauticId(user.mauticId).catch(e => {
        log.warn('getCountMauticId failed:', e.message, e)
        return 1
      })

      const results = await Promise.all([
        (user.identifier ? storage.deleteUser(user) : Promise.reject())
          .then(r => ({ mongodb: 'ok' }))
          .catch(e => ({ mongodb: 'failed' })),
        mauticCount > 1
          ? Promise.resolve({ mautic: 'okMultiNotDeleted' })
          : Mautic.deleteContact(user.mauticId)
              .then(r => ({ mautic: 'ok' }))
              .catch(e => ({ mautic: 'failed' })),
        fetch(`https://api.fullstory.com/users/v1/individual/${user.identifier}`, {
          headers: { Authorization: `Basic ${conf.fullStoryKey}` },
          method: 'DELETE'
        })
          .then(_ => ({ fs: 'ok' }))
          .catch(e => ({ fs: 'failed' })),
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
          .catch(e => ({ amplitude: 'failed' }))
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
    wrapAsync(async (req, res, next) => {
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
    wrapAsync(async (req, res, next) => {
      const { log } = req
      const { identifier = '', email, mobile } = req.body
      const identifierLC = identifier.toLowerCase()

      const queryOrs = [
        { identifier: identifierLC }, // identifier is stored lowercase in the db. we lowercase addresses in the /auth/eth process
        { email: email && sha3(email) },
        { mobile: mobile && sha3(mobile) }
      ].filter(or => !!Object.values(or)[0])

      let existing = await storage.model
        .find(
          {
            $or: queryOrs
          },
          { identifier: 1, email: 1, mobile: 1, createdDate: 1, torusProvider: 1, fullName: 1 }
        ) // sort by importance, prefer oldest verified account
        .sort({ isVerified: -1, createdDate: 1 })
        .lean()

      existing = existing.filter(doc => doc.createdDate)

      if (identifierLC && (email || mobile)) {
        // if email or phone also were specified we want
        // to select matches by id first
        // sortBy sorts in ascending order (and keeps existing sort)
        // so non-matched by id results would be moved to the end
        existing = sortBy(existing, ({ identifier }) => identifier !== identifierLC)
      }

      log.debug('userExists:', { existing, identifier, identifierLC, email, mobile })

      if (existing.length) {
        const bestExisting = first(existing)

        return res.json({
          ok: 1,
          found: existing.length,
          exists: true,
          provider: bestExisting.torusProvider,
          identifier: identifierLC === bestExisting.identifier,
          email: email && sha3(email) === bestExisting.email,
          mobile: mobile && sha3(mobile) === bestExisting.mobile,
          fullName: bestExisting.fullName
        })
      }

      res.json({ ok: 0, exists: false })
    })
  )

  app.get(
    '/profileBy',
    wrapAsync(async (req, res, next) => {
      const { log } = req
      const { valueHash } = req.query

      const queryOrs = [{ email: valueHash }, { mobile: valueHash }, { walletAddress: valueHash }]

      const isValidMatch = doc => {
        //most common case
        if (doc.walletAddress === valueHash) return true

        if (doc.email === valueHash && doc.isEmailConfirmed) return true

        if (doc.mobile === valueHash && doc.smsValidated) return true

        return false
      }

      let existing = await storage.model
        .find(
          {
            $or: queryOrs
          },
          { walletAddress: 1, mobile: 1, email: 1, profilePublickey: 1, isEmailConfirmed: 1, smsValidated: 1 }
        ) // sort by importance, prefer newest verified account
        .sort({ isVerified: -1, createdDate: -1 })
        .lean()

      existing = existing.filter(isValidMatch)

      log.debug('user/profileBy:', { existing, valueHash })

      if (existing.length) {
        const bestExisting = first(existing)

        return res.json({
          ok: 1,
          profilePublickey: bestExisting.profilePublickey
        })
      }

      res.json({ ok: 0, exists: false })
    })
  )

  app.post(
    '/admin/user/get',
    adminAuthenticate,
    wrapAsync(async (req, res, next) => {
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
    wrapAsync(async (req, res, next) => {
      const { body } = req
      let result = {}
      if (body.identifier) result = await storage.deleteUser(body)

      res.json({ ok: 1, result })
    })
  )

  app.post(
    '/admin/model/fish',
    adminAuthenticate,
    wrapAsync(async (req, res, next) => {
      const { body, log } = req
      const { daysAgo } = body
      if (!daysAgo) return res.json({ ok: 0, error: 'missing daysAgo' })
      log.debug('fishing request', { daysAgo })
      fishManager
        .run(daysAgo)
        .then(fishResult => log.info('fishing request result:', { fishResult }))
        .catch(e => log.error('fish request failed', { daysAgo }))

      res.json({ ok: 1 })
    })
  )
  app.post(
    '/admin/user/fixtrust',
    adminAuthenticate,
    wrapAsync(async (req, res, next) => {
      new DBUpdateTask().fixGunTrustProfiles2()
      res.json({ ok: 1 })
    })
  )
}
export default setup

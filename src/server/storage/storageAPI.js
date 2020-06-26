// @flow
import { Router } from 'express'
import passport from 'passport'
import { defaults, omitBy } from 'lodash'
import { sha3 } from 'web3-utils'
import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import addUserSteps from './addUserSteps'
import { generateMarketToken } from '../utils/market'
import createUserVerifier from './verifier'

const setup = (app: Router, gunPublic: StorageAPI, storage: StorageAPI) => {
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
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { body, user: userRecord } = req
      const { user: userPayload = {} } = body
      const logger = req.log

      logger.debug('new user request:', { data: userPayload, userRecord })

      const { email, mobile, ...restPayload } = userPayload

      // if torus, then we first verify the user mobile/email by verifying it matches the torus public key
      // (torus maps identifier such as email and mobile to private/public key pairs)
      const verifier = createUserVerifier(userRecord, userPayload, logger)

      await verifier.verifySignInIdentifiers()

      // check that user email/mobile sent is the same as the ones verified
      if (['production', 'staging'].includes(conf.env)) {
        if (userRecord.smsValidated !== true || userRecord.mobile !== sha3(mobile)) {
          throw new Error('User mobile not verified!')
        }

        if (
          conf.skipEmailVerification === false &&
          (userRecord.isEmailConfirmed !== true || userRecord.email !== sha3(email))
        ) {
          throw new Error('User email not verified!')
        }
      }

      if (userRecord.createdDate) {
        throw new Error('You cannot create more than 1 account with the same credentials')
      }

      // removing creds, nonce, proof and crypto keys from user payload as they shouldn't be stored in the userRecord
      const payloadWithoutCreds = omitBy(restPayload, (_, userProperty) => userProperty.startsWith('torus'))

      const toUpdateUser: UserRecord = defaults(payloadWithoutCreds, {
        identifier: userRecord.loggedInAs,
        regMethod: userPayload.regMethod,
        torusProvider: userPayload.torusProvider,
        email: sha3(email),
        mobile: sha3(mobile),
        isCompleted: userRecord.isCompleted
          ? userRecord.isCompleted
          : {
              whiteList: false,
              w3Record: false,
              marketToken: false,
              topWallet: false
            }
      })

      const userRecordWithPII = { ...userRecord, email, mobile }
      const signUpPromises = []
      const p1 = storage
        .updateUser(toUpdateUser)
        .then(r => logger.debug('updated new user record', { toUpdateUser }))
        .catch(e => {
          logger.error('failed updating new user record', { e, errMessage: e.message, toUpdateUser })
          throw e
        })
      signUpPromises.push(p1)
      if (conf.disableFaceVerification) {
        const p2 = addUserSteps
          .addUserToWhiteList(userRecord, logger)
          .then(isWhitelisted => {
            logger.debug('addUserToWhiteList result', { isWhitelisted })
            if (isWhitelisted === false) throw new Error('Failed whitelisting user')
          })
          .catch(e => {
            logger.error('addUserToWhiteList failed', { e, errMessage: e.message, userRecord })
            throw e
          })
        signUpPromises.push(p2)
      }

      if (process.env.NODE_ENV !== 'development') {
        const p3 = addUserSteps
          .updateMauticRecord(userRecordWithPII, logger)
          .then(r => logger.debug('updateMauticRecord success'))
          .catch(e => {
            logger.error('updateMauticRecord failed', { e, errMessage: e.message, userRecordWithPII })
            throw e
          })
        signUpPromises.push(p3)
      }

      const web3RecordP = addUserSteps
        .updateW3Record(userRecordWithPII, logger)
        .then(r => {
          logger.debug('updateW3Record success')
          return r
        })
        .catch(e => {
          logger.error('updateW3Record failed', { e, errMessage: e.message, userRecordWithPII })
          throw e
        })
      signUpPromises.push(web3RecordP)

      const marketTokenP = addUserSteps
        .updateMarketToken(userRecordWithPII, logger)
        .then(r => {
          logger.debug('updateMarketToken success')
          return r
        })
        .catch(e => {
          logger.error('updateMarketToken failed', { e, errMessage: e.message, userRecordWithPII })
          throw e
        })
      signUpPromises.push(marketTokenP)

      const p4 = addUserSteps
        .topUserWallet(userRecord, logger)
        .then(isTopWallet => {
          if (isTopWallet === false) throw new Error('Failed to top wallet of new user')
          logger.debug('topUserWallet success')
        })
        .catch(e => {
          logger.error('topUserWallet failed', { e, errMessage: e.message, userRecord })
          throw e
        })

      signUpPromises.push(p4)

      const p5 = Promise.all([
        userRecordWithPII.smsValidated &&
          userRecordWithPII.mobile &&
          gunPublic.addUserToIndex('mobile', userRecordWithPII.mobile, userRecordWithPII),
        userRecordWithPII.email &&
          userRecordWithPII.isEmailConfirmed &&
          gunPublic.addUserToIndex('email', userRecordWithPII.email, userRecordWithPII),
        userRecordWithPII.gdAddress &&
          gunPublic.addUserToIndex('walletAddress', userRecordWithPII.gdAddress, userRecordWithPII)
      ])

      signUpPromises.push(p5)
      await Promise.all(signUpPromises)
      logger.debug('signup steps success. adding new user:', { toUpdateUser })

      await storage.updateUser({
        identifier: userRecord.loggedInAs,
        createdDate: new Date().toString(),
        otp: {} //delete trace of mobile,email
      })
      const web3Record = await web3RecordP
      const marketToken = await marketTokenP
      res.json({
        ok: 1,
        loginToken: web3Record && web3Record.loginToken,
        w3Token: web3Record && web3Record.w3Token,
        marketToken
      })
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
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, log } = req
      log.info('delete user', { user })

      const results = await Promise.all([
        (user.identifier ? storage.deleteUser(user) : Promise.reject())
          .then(r => ({ mongodb: 'ok' }))
          .catch(e => ({ mongodb: 'failed' })),
        Mautic.deleteContact(user)
          .then(r => ({ mautic: 'ok' }))
          .catch(e => ({ mautic: 'failed' }))
      ])

      log.info('delete user results', { results })
      res.json({ ok: 1, results })
    })
  )

  /**
   * @api {post} /user/market generate user market login token
   * @apiName Market Token
   * @apiGroup Storage
   *   *
   * @apiSuccess {Number} ok
   * @apiSuccess {String} jwt
   * @ignore
   */
  app.get(
    '/user/market',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, log } = req
      log.debug('new market token request:', { user })
      const jwt = generateMarketToken(user)
      log.debug('new market token result:', { jwt })

      res.json({ ok: 1, jwt })
    })
  )

  app.post(
    '/admin/user/get',
    wrapAsync(async (req, res, next) => {
      const { body } = req
      if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
      let user = {}
      if (body.email) user = await storage.getUserByEmail(sha3(body.email))
      if (body.mobile) user = await storage.getUserByMobile(sha3(body.mobile))
      if (body.identifier) user = await storage.getUser(body.identifier)

      res.json({ ok: 1, user })
    })
  )

  app.post(
    '/admin/user/list',
    wrapAsync(async (req, res, next) => {
      const { body } = req
      if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
      let done = jsonres => {
        res.json(jsonres)
      }
      storage.listUsers(done)
    })
  )

  app.post(
    '/admin/user/delete',
    wrapAsync(async (req, res, next) => {
      const { body } = req
      let result = {}
      if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
      if (body.identifier) result = await storage.deleteUser(body)

      res.json({ ok: 1, result })
    })
  )
}
export default setup

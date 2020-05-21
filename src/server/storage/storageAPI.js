// @flow
import { Router } from 'express'
import passport from 'passport'
import get from 'lodash/get'
import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { defaults } from 'lodash'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import addUserSteps from './addUserSteps'
import { generateMarketToken } from '../utils/market'
import PropsModel from '../db/mongo/models/props'

const setup = (app: Router, storage: StorageAPI) => {
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
      const logger = req.log
      logger.debug('new user request:', { data: body.user, userRecord })
      //check that user passed all min requirements
      if (
        ['production', 'staging'].includes(conf.env) &&
        (userRecord.smsValidated !== true ||
          (conf.skipEmailVerification === false && userRecord.isEmailConfirmed !== true))
      )
        throw new Error('User email or mobile not verified!')

      if (!conf.allowDuplicateUserData && userRecord.createdDate) {
        throw new Error('You cannot create more than 1 account with the same credentials')
      }

      const { email, mobile, ...bodyUser } = body.user

      const user: UserRecord = defaults(bodyUser, {
        identifier: userRecord.loggedInAs,
        regMethod: bodyUser.regMethod,
        torusProvider: bodyUser.torusProvider,
        email: get(userRecord, 'otp.email', email), //for development/test use email from body
        mobile: get(userRecord, 'otp.mobile', mobile), //for development/test use mobile from body
        isCompleted: bodyUser.isCompleted
          ? bodyUser.isCompleted
          : {
              whiteList: false,
              w3Record: false,
              marketToken: false,
              topWallet: false
            }
      })

      const signUpPromises = []
      const p1 = storage
        .updateUser(user)
        .then(r => logger.debug('updated new user record', { user }))
        .catch(e => {
          logger.error('failed updating new user record', { e, errMessage: e.message, user })
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

      if (!userRecord.mauticId && process.env.NODE_ENV !== 'development') {
        const p3 = addUserSteps
          .updateMauticRecord(userRecord, logger)
          .then(r => logger.debug('updateMauticRecord success'))
          .catch(e => {
            logger.error('updateMauticRecord failed', { e, errMessage: e.message, userRecord })
            throw e
          })
        signUpPromises.push(p3)
      }

      const web3RecordP = addUserSteps
        .updateW3Record(user, logger)
        .then(r => {
          logger.debug('updateW3Record success')
          return r
        })
        .catch(e => {
          logger.error('updateW3Record failed', { e, errMessage: e.message, user })
          throw e
        })
      signUpPromises.push(web3RecordP)

      const marketTokenP = addUserSteps
        .updateMarketToken(user, logger)
        .then(r => {
          logger.debug('updateMarketToken success')
          return r
        })
        .catch(e => {
          logger.error('updateMarketToken failed', { e, errMessage: e.message, user })
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

      await Promise.all(signUpPromises)
      logger.debug('signup stepss success. adding new user:', { user })

      await storage.updateUser({
        identifier: userRecord.loggedInAs,
        createdDate: new Date().toString()
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
      if (body.email) user = await storage.getUserByEmail(body.email)
      if (body.mobile) user = await storage.getUserByMobile(body.mobile)
      if (body.identifier) user = await storage.getUser(body.identifier)

      res.json({ ok: 1, user })
    })
  )

  app.post(
    '/admin/queue',
    wrapAsync(async (req, res, next) => {
      const { body, log } = req
      if (body.password !== conf.gundbPassword) return res.json({ ok: 0 })
      const toAdd = body.allow
      const fromDB = await PropsModel.findOne({ name: 'claimQueueAllowed' })
      const prevAllowed = fromDB || { value: conf.claimQueueAllowed }
      const newAllowed = prevAllowed.value + toAdd
      await PropsModel.updateOne({ name: 'claimQueueAllowed' }, { $set: { value: newAllowed } }, { upsert: true })

      const totalPending = await storage.model.count({ 'claimQueue.status': 'pending' })
      const stillPending = totalPending - toAdd
      const pendingUsers = await storage.model
        .find(
          { 'claimQueue.status': 'pending' },
          { mauticId: 1, 'claimQueue.date': 1, identifier: 1 },
          {
            sort: { 'claimQueue.date': 1 }, //get first in queue first
            limit: toAdd
          }
        )
        .lean()
      const approvedUsers = pendingUsers.map(_ => _._id)
      storage.model.updateMany({ _id: { $in: approvedUsers } }, { $set: { 'claimQueue.status': 'approved' } })
      log.debug('claim queue updated', { pendingUsers, newAllowed, stillPending })
      res.json({ ok: 1, newAllowed, pendingUsers, stillPending })
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

  /**
   * @api {post} /user/enqueue Puts user in claim queue for phase1
   * @apiName Enqueue
   * @apiGroup Storage
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {String} status
   * @ignore
   */
  app.post(
    '/user/enqueue',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, log, body } = req

      log.debug('claimqueue:', { allowed: conf.claimQueueAllowe, queue: user.claimQueue })
      //if queue not enabled, user already in queue or user already whitelisted we skip adding to queue
      if (conf.claimQueueAllowed <= 0 || user.claimQueue) {
        return res.json({ ok: 0, queue: user.claimQueue || { status: 'verified' } })
      }
      const totalQueued = await storage.model.count({ 'claimQueue.status': { $exists: true } })
      const openSpaces = conf.claimQueueAllowed - totalQueued

      let status = openSpaces > 0 ? 'approved' : 'pending'
      //if user was added to queue tag him in mautic
      if (['test', 'development'].includes(conf.env) === false && user.mauticId && status === 'pending')
        Mautic.updateContact(user.mauticId, { tags: ['inClaimQueue'] }).catch(e => {
          log.error('Failed Mautic tagging queued user', { errMessage: e.message, e })
        })
      storage.updateUser({ identifier: user.identifier, claimQueue: { status, date: Date.now() } })
      res.json({ ok: 1, queue: { status, date: Date.now() } })
    })
  )
}
export default setup

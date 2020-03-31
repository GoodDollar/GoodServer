// @flow
import { Router } from 'express'
import passport from 'passport'
import get from 'lodash/get'
import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { defaults } from 'lodash'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import { recoverPublickey } from '../utils/eth'
import zoomHelper from '../verification/faceRecognition/faceRecognitionHelper'
import addUserSteps from './addUserSteps'
import { generateMarketToken } from '../utils/market'

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

      await storage.updateUser(user)

      if (conf.disableFaceVerification) {
        const isWhitelisted = await addUserSteps.addUserToWhiteList(userRecord)
        if (isWhitelisted === false) throw new Error('Failed whitelisting user')
      }

      if (!userRecord.mauticId && process.env.NODE_ENV !== 'development') {
        await addUserSteps.updateMauticRecord(userRecord)
      }

      const web3Record = await addUserSteps.updateW3Record(user)

      const marketToken = await addUserSteps.updateMarketToken(user)

      let isTopWallet = await addUserSteps.topUserWallet(userRecord)
      if (isTopWallet === false) throw new Error('Failed to top wallet of user')
      logger.debug('added new user:', { user, isTopWallet })

      await storage.updateUser({
        identifier: userRecord.loggedInAs,
        createdDate: new Date().toString()
      })

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
   * @apiParam {String} zoomId
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {[Object]} results
   * @ignore
   */
  app.post(
    '/user/delete',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { user, log, body } = req
      const { zoomSignature, zoomId } = body
      log.info('delete user', { user })

      if (zoomId && zoomSignature) {
        const recovered = recoverPublickey(zoomSignature, zoomId, '').replace('0x', '')

        if (recovered === body.zoomId.toLowerCase()) {
          await zoomHelper.delete(zoomId)
          log.info('zoom delete', { zoomId })
        } else {
          log.warn('/user/delete', { message: 'SigUtil unable to recover the message signer' })
          throw new Error('Unable to verify credentials')
        }
      }

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

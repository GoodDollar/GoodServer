// @flow
import { Router } from 'express'
import passport from 'passport'
import get from 'lodash/get'
import { type StorageAPI, UserRecord } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { defaults } from 'lodash'
import fetch from 'cross-fetch'
import md5 from 'md5'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import AdminWallet from '../blockchain/AdminWallet'
// import Helper from '../verification/faceRecognition/faceRecognitionHelper'

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
    wrapAsync(async (req, res, next) => {
      const { body, user: userRecord, log } = req
      const logger = req.log.child({ from: 'storageAPI - /user/add' })
      log.debug('new user request:', { data: body.user, userRecord })
      //check that user passed all min requirements
      if (
        ['production', 'staging'].includes(conf.env) &&
        (userRecord.smsValidated !== true ||
          (conf.skipEmailVerification === false && userRecord.isEmailConfirmed !== true))
      )
        throw new Error('User email or mobile not verified!')

      const { email, mobile, ...bodyUser } = body.user
      const user: UserRecord = defaults(bodyUser, {
        identifier: userRecord.loggedInAs,
        createdDate: new Date().toString()
      })

      if (conf.disableFaceVerification) {
        AdminWallet.whitelistUser(userRecord.gdAddress, userRecord.profilePublickey)
      }

      const mauticRecordPromise =
        process.env.NODE_ENV === 'development'
          ? Promise.resolve({})
          : Mautic.createContact(user).catch(e => {
              log.error('Create Mautic Record Failed', e)
            })

      const secureHash = md5(user.email + conf.secure_key)

      log.debug('secureHash', secureHash)

      const web3RecordPromise = fetch(`${conf.web3SiteUrl}/api/wl/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          secure_hash: secureHash.toLowerCase(),
          email: user.email,
          full_name: user.fullName,
          wallet_address: user.gdAddress
        })
      })
        .then(res => res.json())
        .catch(e => {
          log.error('Get Web3 Login Response Failed', e)
        })

      const [mauticRecord, web3Record] = await Promise.all([mauticRecordPromise, web3RecordPromise])

      log.debug('Web3 user record', web3Record)

      //mautic contact should already exists since it is first created during the email verification we update it here
      const mauticId = get(mauticRecord, 'contact.fields.all.id', -1)
      logger.debug('User mautic record', { mauticId, mauticRecord })

      const updateUserObj = {
        ...user,
        mauticId
      }

      const w3RecordData = web3Record && web3Record.data

      if (w3RecordData && w3RecordData.login_token) {
        updateUserObj.loginToken = w3RecordData.login_token
      }

      storage.updateUser(updateUserObj)

      //topwallet of user after registration
      let ok = await AdminWallet.topWallet(userRecord.gdAddress, null, true)
        .then(r => ({ ok: 1 }))
        .catch(e => {
          logger.error('New user topping failed', e.message)
          return { ok: 0, error: 'New user topping failed' }
        })
      log.debug('added new user:', { user, ok })

      res.json({
        ...ok,
        loginToken: w3RecordData && w3RecordData.login_token
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
      const { user, log } = req
      log.info('delete user', { user })
      const results = await Promise.all([
        (user.identifier ? storage.deleteUser(user) : Promise.reject())
          .then(r => ({ gundb: 'ok' }))
          .catch(e => ({ gundb: 'failed' })),
        Mautic.deleteContact(user)
          .then(r => ({ mautic: 'ok' }))
          .catch(e => ({ mautic: 'failed' }))
      ])
      log.info('delete user results', { results })
      res.json({ ok: 1, results })
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

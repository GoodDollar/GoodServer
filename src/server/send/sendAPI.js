// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { sendLinkByEmail, sendLinkBySMS } from './send.sendgrid'
import { Mautic } from '../mautic/mauticAPI'
import conf from "../server.config";
import type { StorageAPI } from '../../imports/types'

const setup = (app: Router, storage: StorageAPI) => {
  /**
   * @api {post} /send/linkemail Send link email
   * @apiName Link Email
   * @apiGroup Send
   *
   * @apiParam {String} to
   * @apiParam {String} sendLink
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/send/linkemail',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linkemail' })
      const { user } = req
      const { to, sendLink } = req.body

      log.info('sending email', { to, sendLink })
      await sendLinkByEmail(to, sendLink)
      res.json({ ok: 1 })
    })
  )

  /**
   * @api {post} /send/linksms Send link sms
   * @apiName Link SMS
   * @apiGroup Send
   *
   * @apiParam {String} to
   * @apiParam {String} sendLink
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/send/linksms',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linksms' })
      const { user } = req
      const { to, sendLink } = req.body

      log.info('sending sms', { to, sendLink })
      await sendLinkBySMS(to, sendLink)
      res.json({ ok: 1 })
    })
  )
  
  /**
   * @api {post} /send/recoveryinstructions Send recovery instructions email
   * @apiName Recovery Instructions
   * @apiGroup Send
   *
   * @apiParam {String} mnemonic
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/send/recoveryinstructions',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/recoveryinstructions' })
      const { user } = req
      const { mnemonic } = req.body
      
      log.info('sending recovery email', user)
      //at this stage user record should contain all his details
      await Mautic.sendRecoveryEmail(user, mnemonic)
      res.json({ ok: 1 })
    })
  )
  
  /**
   * @api {post} /send/magiclink Send recovery instructions email
   * @apiName Recovery Instructions
   * @apiGroup Send
   *
   * @apiParam {String} magicLine
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/send/magiclink',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging', 'test', 'development'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/magiclink' })
      const { user } = req
      const { magicLine } = req.body
      let userRec = user
      if (!user.mauticId || user.mauticId < 0) {
        const mauticContact = await Mautic.createContact(userRec)
        userRec.mauticId = mauticContact.contact.fields.all.id
        log.debug('created new user mautic contact', userRec)
      }
      const magicLink = `${conf.walletUrl}/?magicline=${magicLine}`
      log.info('sending magiclink email', userRec, magicLink)
      //at this stage user record should contain all his details
      storage.updateUser({
        identifier: user.loggedInAs,
        mauticId: userRec.mauticId
      })
      await Mautic.sendMagicLinkEmail(userRec, magicLink)
      res.json({ ok: 1 })
    })
  )
}

export default setup

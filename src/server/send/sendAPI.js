// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { sendLinkByEmail, sendLinkBySMS } from './send.sendgrid'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'

const setup = (app: Router) => {
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
      const recoverPageUrl = `${conf.walletUrl}/Auth/Recover`

      log.info('sending recovery email', user)
      //at this stage user record should contain all his details
      await Mautic.sendRecoveryEmail(user, mnemonic, recoverPageUrl)
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
    onlyInEnv('production', 'staging', 'test'),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/magiclink' })
      const { user } = req
      const { magiclink } = req.body
      let userRec = user
      const fullMagicLink = `${conf.walletUrl}/?magiclink=${magiclink}`
      log.info('sending fullMagicLink email', userRec, fullMagicLink)
      //at this stage user record should contain all his details
      await Mautic.sendMagicLinkEmail(userRec, fullMagicLink)
      res.json({ ok: 1 })
    })
  )
}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInProduction } from '../utils/helpers'
import { sendLinkByEmail, sendLinkBySMS, sendRecoveryInstructionsByEmail } from './send'

const setup = (app: Router) => {
  app.post(
    '/send/linkemail',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linkemail' })
      const { user } = req
      const { to, sendLink } = req.body

      log.info('sending email', { to, sendLink })
      await sendLinkByEmail(to, sendLink)
      res.json({ ok: 1 })
    })
  )

  app.post(
    '/send/linksms',
    passport.authenticate('jwt', { session: false }),
    onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linksms' })
      const { user } = req
      const { to, sendLink } = req.body

      log.info('sending sms', { to, sendLink })
      await sendLinkBySMS(to, sendLink)
      res.json({ ok: 1 })
    })
  )

  app.post(
    '/send/recoveryinstructions',
    passport.authenticate('jwt', { session: false }),
    // onlyInProduction,
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linkemail' })
      const { user } = req
      const { to, name, mnemonic } = req.body

      log.info('sending email', { to, name, mnemonic })
      await sendRecoveryInstructionsByEmail(to, name, mnemonic)
      res.json({ ok: 1 })
    })
  )
}

export default setup

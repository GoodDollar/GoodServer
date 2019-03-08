// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync } from '../utils/helpers'
import { sendLinkByEmail } from './send'

const setup = (app: Router) => {
  app.post(
    '/send/linkemail',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'sendAPI - /send/linkemail' })
      const { user } = req
      const { to, sendLink } = req.body

      log.info('sending email', { to, sendLink })
      await sendLinkByEmail(to, sendLink)
      res.json({ ok: 1 })
    })
  )
}

export default setup

// @flow
import { Router } from 'express'
import passport from 'passport'
import { type StorageAPI } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { defaults } from 'lodash'
import { UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
const setup = (app: Router, storage: StorageAPI) => {
  app.post(
    '/user/add',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { body } = req
      const user: UserRecord = defaults(body.user, { identifier: req.user.loggedInAs })
      //mautic contact should already exists since it is first created during the email verification we update it here
      const mauticRecord = await Mautic.createContact(user)
      await storage.updateUser({ ...user, mauticId: mauticRecord.contact.fields.all.id })

      res.json({ ok: 1 })
    })
  )

  app.post(
    '/user/delete',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { body } = req
      const user = defaults(body.user, { identifier: req.user.loggedInAs })
      await storage.deleteUser(user)
      res.json({ ok: 1 })
    })
  )
}
export default setup

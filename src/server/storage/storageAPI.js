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
      await storage.addUser(user)
      //if adduser went ok then we create a contact and update the user with mauticId
      const mauticRecord = await Mautic.createContact(user)
      storage.addUser({ mauticId: mauticRecord.contact.fields.all.id, identifier: req.user.loggedInAs })

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

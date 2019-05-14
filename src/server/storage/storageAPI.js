// @flow
import { Router } from 'express'
import passport from 'passport'
import get from 'lodash/get'
import { type StorageAPI } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'
import { defaults } from 'lodash'
import { UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
import conf from '../server.config'
import AdminWallet from '../blockchain/AdminWallet'

const setup = (app: Router, storage: StorageAPI) => {
  app.post(
    '/user/add',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { body, user: userRecord, log } = req
      //check that user passed all min requirements
      if (['production', 'staging'].includes(conf.env) && (!userRecord.smsValidated || !userRecord.isEmailConfirmed))
        throw new Error('User email or mobile not verified!')

      const user: UserRecord = defaults(body.user, { identifier: userRecord.loggedInAs })
      //mautic contact should already exists since it is first created during the email verification we update it here
      const mauticRecord = process.env.NODE_ENV === 'development' ? {} : await Mautic.createContact(user)
      //topwallet of user after registration
      await Promise.all([
        AdminWallet.topWallet(userRecord.gdAddress, null, true).catch(e => log.error(e)),
        storage.updateUser({ ...user, mauticId: get(mauticRecord, 'contact.fields.all.id', -1) })
      ])
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

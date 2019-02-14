// @flow
import { Router } from 'express'
import passport from 'passport'
import { type StorageAPI } from '../../imports/types'
import { wrapAsync } from '../utils/helpers'

const setup = (app: Router, storage: StorageAPI) => {
  app.post(
    '/user/add',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { body } = req
      await storage.addUser(body.user)
      res.json({ ok: 1 })
    })
  )

  app.post(
    '/user/delete',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const { body } = req
      await storage.deleteUser(body.user)
      res.json({ ok: 1 })
    })
  )
}
export default setup

// @flow
import passport from "passport"
import { get } from 'lodash'
import { type UserRecord, type StorageAPI } from '../../imports/types'
import { wrapAsync } from '../server-middlewares'

const setup = (app:express, storage:StorageAPI) => {

  app.post("/user/add", passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const { user, body } = req
    await storage.addUser(body.user)
    res.json({ ok: 1 })
  }))

  app.post("/user/delete", passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const { user, body } = req
    await storage.deleteUser(body.user)
    res.json({ ok: 1 })
  }));
}

export default setup

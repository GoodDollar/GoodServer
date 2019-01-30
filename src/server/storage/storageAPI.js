// @flow
import passport from "passport"
import { get } from 'lodash'
import { type UserRecord, type StorageAPI } from '../../imports/types'



function wrapAsync(fn) {
  return function (req, res, next) {
    // Make sure to `.catch()` any errors and pass them along to the `next()`
    // middleware in the chain, in this case the error handler.
    fn(req, res, next).catch(next);
  };
}

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

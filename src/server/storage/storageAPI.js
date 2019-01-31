// @flow
import { Router } from 'express'
import type { NextFunction } from 'express'
import passport from "passport"
import { get } from 'lodash'

type UserRecord = {
    pubkey:string,
    fullName?:string,
    mobile?:string,
    email?:string,
    jwt?:string
}
interface StorageAPI {
    addUser(user: UserRecord): Promise<boolean>,
    updateUser(user: UserRecord): Promise<boolean>,
    deleteUser(user: UserRecord): Promise<boolean>
}

function wrapAsync(fn) {
  return function (req, res, next: NextFunction) {
    // Make sure to `.catch()` any errors and pass them along to the `next()`
    // middleware in the chain, in this case the error handler.
    fn(req, res, next).catch(next);
  };
}

const setup = (app: Router, storage: StorageAPI) => {
  app.post("/user/*", passport.authenticate("jwt", { session: false }), wrapAsync(async (req, res, next) => {
    const { user, body, log } = req
    log.trace("user/* auth:", { user, body })
    const pubkey = get(body, 'user.pubkey')
    if (user.pubkey !== pubkey) {
      log.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`);
      throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
    } else next()
  }))

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
export type { StorageAPI, UserRecord }

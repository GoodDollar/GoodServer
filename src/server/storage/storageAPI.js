// @flow
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
    addUser(user: UserRecord):boolean,
    updateUser(user: UserRecord):boolean,
    deleteUser(user: UserRecord):boolean
}

const setup = (app:express, storage:StorageAPI) => {
  app.post("/user/add", passport.authenticate("jwt", { session: false }), (req, res) => {
    const { user, body } = req
    console.log("user/add:", { user, body })
    const pubkey = get(body,'user.pubkey')
    if (user.pubkey === pubkey) {
      storage.addUser(body.user)
      res.json({ok:1})
    } else {
      console.error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`);
      throw new Error(`Trying to update other user data! ${user.pubkey}!==${pubkey}`)
    }
  });
}

export default setup
export type { StorageAPI, UserRecord }

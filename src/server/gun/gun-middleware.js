// @flow
import Gun from "gun"
import SEA from "gun/sea"
import { get, each } from "lodash"
import type { StorageAPI, UserRecord } from "../storage/storageAPI"
import logger from '../../imports/pino-logger'

const log = logger.child({ from: 'GunDB-Middleware', level: 30 })

const setup = (app) => {
  app.use(Gun.serve);
  global.Gun = Gun; // / make global to `node --inspect` - debug only
  log.info("Done setup GunDB middleware.")
}
class GunDB implements StorageAPI {
  init(server, password) {
    this.gun = Gun({ web: server })
    this.user = this.gun.user()
    this.user.create("gooddollar", password,
      (createres) => {
        log.trace("Create GoodDollar User", { createres })
        this.user.auth("gooddollar", password,
          async (authres) => {
            log.trace("Authenticated GunDB user:", authres)
            // this.user.get("users").map(async (v, k) => console.log({ v: await SEA.decrypt(v, this.user.pair()), k }))
            // this.setUserDetails("0x0", "www", { fullName: "GoodDollar" })
          })
      })
  }

  addUser(user:UserRecord) {
    this.updateUser(user)
  }

  updateUser(user:UserRecord) {
    const { pubkey } = user
    this.gun.get("users").get(pubkey).put(user)
    // this.user.get('users').get(pubkey).secret({...user, jwt})
  }

  deleteUser(user:UserRecord) {
    const { pubkey } = user
    this.gun.get("users").get(pubkey).put(null)
  }
}
const GunDBInstance = new GunDB()
export { setup, GunDBInstance }

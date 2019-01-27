// @flow
import Gun from "gun"
import SEA from "gun/sea"
import { get, each } from "lodash"
import type { StorageAPI, UserRecord } from "../storage/storageAPI"
import conf from '../server.config'

const setup = (app) => {
  app.use(Gun.serve);
  global.Gun = Gun; // / make global to `node --inspect` - debug only
  console.info("Done setup GunDB middleware.")
}
class GunDB implements StorageAPI {
  gun:Gun

  user:Gun

  serverName:string

  init(server:express, password:string, name:string) {
    this.gun = Gun({ web: server, file: name })
    this.user = this.gun.user()
    this.serverName = name
    this.user.create("gooddollar", password,
      (createres) => {
        console.log("Create GoodDollar User", { createres })
        this.user.auth("gooddollar", password,
          async (authres) => {
            console.log("Authenticated GunDB user:", authres)
            this.usersCol = this.user.get('users')
          })
      })
  }

  async addUser(user:UserRecord):Promise<boolean> {
    return this.updateUser(user)
  }

  async updateUser(user:UserRecord):Promise<boolean> {
    const { pubkey } = user
    const isDup = await this.isDupUserData(user)
    if (!isDup) {
      this.usersCol.get("users").get(pubkey).put(user)
      if (user.email) this.usersCol.get("byemail").put({ [user.email]: pubkey })

      if (user.mobile) this.usersCol.get("bymobile").put({ [user.mobile]: pubkey })
      return true
    }
    return Promise.reject(new Error("Duplicate user information (phone/email)"))
    // this.user.get('users').get(pubkey).secret({...user, jwt})
  }

  async isDupUserData(user:UserRecord) {
    if (user.email) {
      const res = await this.usersCol.get('byemail').get(user.email).then()
      if (res && res !== user.pubkey) return true
    }

    if (user.mobile) {
      const res = await this.usersCol.get('bymobile').get(user.mobile).then()
      if (res && res !== user.pubkey) return true
    }

    return false
  }

  async deleteUser(user:UserRecord):Promise<boolean> {
    const { pubkey } = user
    const userRecord = await this.usersCol.get(pubkey).then()
    console.log("deleteUser fetched record:",{userRecord})
    if (userRecord.email) {
      this.usersCol.get('byemail').get(userRecord.email).put(null)
    }

    if (userRecord.mobile) {
      this.usersCol.get('bymobile').get(userRecord.mobile).put(null)
    }

    this.usersCol.get(pubkey).put(null)
    return true
  }
}
const GunDBPublic = new GunDB()
const GunDBPrivate = new GunDB()
GunDBPrivate.init(null, conf.gundbPassword, 'privatedb')
export { setup, GunDBPublic, GunDBPrivate }

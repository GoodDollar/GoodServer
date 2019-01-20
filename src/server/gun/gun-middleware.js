// @flow
import Gun from "gun"
import SEA from "gun/sea"

type UserRecord = {
  fullName:string,
  mobile:string,
  email:email
}
const setup = (app:express) => {
  app.use(Gun.serve);
  global.Gun = Gun; // / make global to `node --inspect` - debug only
  console.info("Done setup GunDB middleware.")
}
class GunDB {
  init(server, password) {
    this.gun = Gun({ web: server })
    this.user = this.gun.user()
    this.user.create("gooddollar", password,
      () => this.user.auth("gooddollar", password,
        async (authres) => {
          console.log("Authenticated GunDB user:", authres)
          this.user.get('users').map(async (v,k) => console.log({v:await SEA.decrypt(v,this.user.pair()), k}))
          // this.setUserDetails("0x0","www",{fullName:"GoodDollar"})
        }
      ))
  }

  setUserDetails(pubkey,jwt,user:UserRecord) {
    this.user.get('users').get(pubkey).secret({...user, jwt})
  }
}
const GunDBInstance = new GunDB()
export { setup, GunDBInstance }

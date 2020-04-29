// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { recoverPublickey } from '../utils/eth'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import Gun from 'gun'
import 'gun/sea'
import './gundb-extend'
const setup = (app: Router) => {
  /**
   * Only for loadtets
   */
  app.post(
    '/test/add/whitelistUser',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('test', 'development'),
    wrapAsync(async (req, res, next) => {
      const { body } = req
      const gdSignature = body.gdSignature
      const nonce = body.nonce
      const msg = 'Login to GoodDAPP'
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      console.log('#############################################')
      console.log(gdPublicAddress)
      console.log('#############################################')
      const hash = await AdminWallet.whitelistUser(gdPublicAddress, body.profilePublickey)
      console.log('xxxxxxxx hash', { hash })
      res.json({ ok: 1 })
    })
  )

  app.get(
    '/test/recoverSeeds',
    onlyInEnv('test', 'development'),
    wrapAsync(async (req, res, next) => {
      const gun = Gun('https://etorogun-prod.herokuapp.com/gun')

      const users = await UserDBPrivate.listUsers({ magiclink: 1, mnemonic: 1 })
      let i
      console.log('total users:', users.length)
      for (i in users) {
        const u = users[i]
        console.log('user index:', i)
        if ([259, 329, 351].includes(i)) {
          console.log('skipping', u)
          continue
        }
        if (u.mnemonic || u.magiclink === undefined || !u.email || u.email.indexOf('etoro') < 0) {
          // if (u.email && u.email.indexOf('etoro')) console.log('no magiclink for or has mnemonic:', u.email, u.mnemonic)
          continue
        }
        let userNameAndPWD = Buffer.from(u.magiclink, 'base64').toString('ascii')
        let userNameAndPWDArray = userNameAndPWD.split('+')
        // eslint-disable-next-line no-loop-func
        await new Promise((res, rej) => {
          gun.user().auth(userNameAndPWDArray[0], userNameAndPWDArray[1], async r => {
            const profile = gun.user().get('profile')
            const raw = await profile.get('mnemonic')
            const mnemonic = await profile
              .get('mnemonic')
              .get('value')
              .decrypt()
            if (mnemonic && typeof mnemonic === 'string' && mnemonic.split(' ').length === 12) {
              await UserDBPrivate.updateUser({ identifier: u.identifier, mnemonic })
              console.log('updated:', u)
            } else console.log('Bad mnemonic', u.email, mnemonic, raw)
            res(r)
          })
        })
      }

      // console.log(users)
      res.json({ ok: 1 })
    })
  )
}

export default setup

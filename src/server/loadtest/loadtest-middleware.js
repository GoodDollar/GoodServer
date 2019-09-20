// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { recoverPublickey } from '../utils/eth'
import AdminWallet from '../blockchain/AdminWallet'

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
      console.log('################### START #####################')
      const gdSignature = body.gdSignature
      const nonce = body.nonce
      const msg = 'Login to GoodDAPP'
      const t1 = +new Date()
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      const t2 = +new Date()
      console.log(`######### RECOVER TIME ${t2 - t1}ms ###########`)
      console.log(gdPublicAddress)
      const hash = await AdminWallet.whitelistUser(gdPublicAddress, body.profilePublickey)
      console.log(hash)
      console.log('################ END ##########################')
      res.json({ ok: 1 })
    })
  )
}

export default setup

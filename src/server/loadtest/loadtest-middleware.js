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
      const gdSignature = body.gdSignature
      const nonce = body.nonce
      const msg = 'Login to GoodDAPP'
      const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
      console.log('#############################################')
      console.log(gdPublicAddress)
      console.log('#############################################')
      const hash = await AdminWallet.whitelistUser(gdPublicAddress, body.profilePublickey)
      console.log('xxxxxxxx hash', hash)
      res.json({ ok: 1 })
    })
  )
}

export default setup

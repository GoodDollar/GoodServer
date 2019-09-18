// @flow
import { Router } from 'express'
import passport from 'passport'
import { wrapAsync, onlyInEnv } from '../utils/helpers'
import { recoverPublickey } from '../utils/eth'
import AdminWallet from '../blockchain/AdminWallet'
import logger from '../../imports/pino-logger'
const log = logger.child({ from: 'loadtestWhitelistUser' })

const setup = (app: Router) => {
  /**
   * Only for loadtets
   */
  app.post(
    '/test/add/whitelistUser',
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('test', 'development'),
    wrapAsync(async (req, res, next) => {
      try {
        const { body } = req
        const gdSignature = body.gdSignature
        const nonce = body.nonce
        const msg = 'Login to GoodDAPP'
        const gdPublicAddress = recoverPublickey(gdSignature, msg, nonce)
        log.info('#############################################')
        log.info(gdPublicAddress)
        log.info('#############################################')
        const hash = await AdminWallet.whitelistUser(gdPublicAddress, body.profilePublickey)
        log.info('hash', hash)
        res.json({ ok: 1 })
      } catch (e) {
        log.error('whitelistUser test error', e)
        throw new Error(e)
      }
    })
  )
}

export default setup

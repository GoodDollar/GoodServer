// @flow
import axios from 'axios'
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Router } from 'express'
import conf from '../server.config'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'

const setup = (app: Router) => {
  app.post(
    '/livetest/enroll',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'livenesstest' })
      const { body } = req
      const user = defaults(body.user, { identifier: req.user.loggedInAs })
      const livenessApi = conf.faceRecoServer + '/users'

      log.info(`Sending request to: ${livenessApi}`)
      const faceReq = {
        name: user.fullName,
        email: user.email,
        sessionId: body.sessionId,
        facemap: body.facemap,
        auditTrailImage: body.auditTrailImage
      }
      log.info(`sending request`, { faceReq })

      //let response = await axios.post(livenessApi, faceReq)
      res.json({ ok: 1 })
    })
  )
}

export default setup

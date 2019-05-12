// @flow
import multer from 'multer'
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Router } from 'express'
import FormData from 'form-data'
import conf from '../server.config'
import { get, defaults } from 'lodash'
import { Helper } from './faceRecognitionHelper'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'

const setup = (app: Router) => {
  var storage = multer.memoryStorage()
  var upload = multer({ dest: 'uploads/' }) // to handle blob parameters of faceReco
  //var upload = multer({ storage: storage })
  app.post(
    '/livetest/facerecognition',
    passport.authenticate('jwt', { session: false }),
    upload.any(),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'livenesstest' })
      const { body, files, user } = req
      let form: FormData = Helper.prepareZoomData(body, files)
      log.info({ form })
      try {
        let livenessPassed = await Helper.isLivenessPassed(form)
        if (!livenessPassed) res.json({ ok: 1, livenessPassed: livenessPassed })

        let duplicates = await Helper.isDuplicatesExist({
          sessionId: body.sessionId,
          enrollmentIdentifier: body.enrollmentIdentifier,
          minMatchLevel: conf.minMatchLevel
        })
      } catch (e) {
        log.error(e)
        throw e
      }
    })
  )
}

export default setup

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
      const { form, facemapfile, enrollmentIdentifier, sessionId } = Helper.prepareLivenessData(body, files)
      let livenessData: FormData = form
      // log.info('livenessData', { livenessData })

      let livenessPassed = await Helper.isLivenessPassed(livenessData)
      if (!livenessPassed) return res.json({ ok: 1, livenessPassed: livenessPassed })

      let searchData = Helper.prepareSearchData(sessionId, facemapfile)
      // log.info('searchData', { searchData })
      let duplicates = await Helper.isDuplicatesExist(searchData)
      if (duplicates) return res.json({ ok: 1, livenessPassed: livenessPassed, duplicates: duplicates })
      let enrollData = Helper.prepareEnrollmentData(enrollmentIdentifier, sessionId, facemapfile)
      // log.info('enrollData', { enrollData })
      let enroll = await Helper.enroll(enrollData)
      return res.json({ ok: 1, livenessPassed: livenessPassed, duplicates: duplicates, enrollment: enroll })
    })
  )
}

export default setup

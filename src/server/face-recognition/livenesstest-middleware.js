// @flow
import fs from 'fs'
import _ from 'lodash'
import axios from 'axios'
import multer from 'multer'
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Router } from 'express'
import FormData from 'form-data'
import conf from '../server.config'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'

const setup = (app: Router) => {
  var storage = multer.memoryStorage()
  var upload = multer({ dest: 'uploads/' }) // to handle blob parameters of faceReco
  //var upload = multer({ storage: storage })
  app.post(
    '/livetest/enroll',
    passport.authenticate('jwt', { session: false }),
    upload.any(),
    wrapAsync(async (req, res, next) => {
      const log = req.log.child({ from: 'livenesstest' })
      const { body, files, user } = req
      log.info({ files })
      const livenessApi = conf.faceRecoServer + '/users'
      let form = new FormData()
      let facemapfile = _.find(files, { fieldname: 'facemap' }).path
      let auditTrailImagefile = _.find(files, { fieldname: 'audit_trail_image' }).path
      let facemap = fs.createReadStream(facemapfile)
      let auditTrailImage = fs.createReadStream(auditTrailImagefile)
      log.debug({ user })
      log.debug({ body })

      form.append('name', user.fullName)
      form.append(
        'email',
        Math.random()
          .toString(36)
          .substring(7) + user.email
      )
      form.append('session_id', body.session_id)
      form.append('facemap', facemap)
      form.append('audit_trail_image', auditTrailImage)

      try {
        let response = await axios({
          method: 'post',
          url: livenessApi,
          data: form,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${form._boundary}`
          }
        })

        res.json({ ok: 1, livenessFailed: response.livenessFailed, duplicates: response.duplicates })
      } catch (error) {
        if (error.response) {
          log.error(error.response.data)
          res.json({ ok: 0, livenessFailed: error.response.livenessFailed, duplicates: error.response.duplicates })
        } else if (error.request) {
          // TODO: handle general error to the client - The request was made but no response was received

          log.error(error.request)
        } else {
          // Something happened in setting up the request that triggered an Error
          // TODO: handle general error to the client
          log.error('Error', error.message)
        }
      }
    })
  )
}

export default setup

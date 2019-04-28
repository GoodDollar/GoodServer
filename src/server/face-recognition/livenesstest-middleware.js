// @flow
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Router } from 'express'
import { get, defaults } from 'lodash'
import logger from '../../imports/pino-logger'
import { wrapAsync, lightLogs } from '../utils/helpers'

const setup = (app: Router) => {
  app.post(
    '/livetest/enroll',
    lightLogs(async (req, res) => {
      const log = req.log.child({ from: 'livenesstest' })
      log.info(`enroll was called ${{ req }}`)
    })
  )
}

export default setup

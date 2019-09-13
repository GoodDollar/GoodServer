// @flow
// import heapdump from 'heapdump'
import { Router } from 'express'
import type { $Request, $Response, NextFunction } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import pino from 'express-pino-logger'
import addLoginMiddlewares from './login/login-middleware'
import { setup as addGunMiddlewares } from './gun/gun-middleware'
import UserDBPrivate from './db/mongo/user-privat-provider'
import addStorageMiddlewares from './storage/storageAPI'
import addVerificationMiddlewares from './verification/verificationAPI'
import addSendMiddlewares from './send/sendAPI'
import addLoadTestMiddlewares from './loadtest/loadtest-middleware'
import logger, { rollbar } from '../imports/pino-logger'
import VerificationAPI from './verification/verification'

export default (app: Router, env: any) => {
  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms
  app.use(
    bodyParser.urlencoded({
      extended: true
    })
  )

  // parse application/json
  app.use(bodyParser.json())

  app.options(cors())
  app.use(cors())

  app.use(pino({ logger }))

  addLoginMiddlewares(app)
  addGunMiddlewares(app)
  addStorageMiddlewares(app, UserDBPrivate)
  addVerificationMiddlewares(app, VerificationAPI, UserDBPrivate)
  addSendMiddlewares(app)
  addLoadTestMiddlewares(app)
  
  if (rollbar) app.use(rollbar.errorHandler())

  app.use((error, req, res, next: NextFunction) => {
    const log = req.log.child({ from: 'errorHandler' })
    log.error(error)
    res.status(400).json({ message: error.message })
  })
}

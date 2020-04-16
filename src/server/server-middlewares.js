// @flow
import express, { Router } from 'express'
import type { NextFunction } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import addLoginMiddlewares from './login/login-middleware'
import { setup as addGunMiddlewares } from './gun/gun-middleware'
import UserDBPrivate from './db/mongo/user-privat-provider'
import CronTasksRunner from './cron/TaskRunner'
import addStorageMiddlewares from './storage/storageAPI'
import addVerificationMiddlewares from './verification/verificationAPI'
import addSendMiddlewares from './send/sendAPI'
import addLoadTestMiddlewares from './loadtest/loadtest-middleware'
import { rollbar, addRequestLogger } from '../imports/logger'
import VerificationAPI from './verification/verification'
import createDisposeEnrollmentsTask from './verification/cron/DisposeEnrollmentsTask'
export default (app: Router, env: any) => {
  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms

  app.use(express.json({ limit: '100mb', extended: true }))

  // parse application/json
  app.use(bodyParser.json({ limit: '100mb' }))

  app.options(cors())
  app.use(cors())
  app.use(addRequestLogger)
  addLoginMiddlewares(app)
  addGunMiddlewares(app)
  addStorageMiddlewares(app, UserDBPrivate)
  addVerificationMiddlewares(app, VerificationAPI, UserDBPrivate)
  addSendMiddlewares(app, UserDBPrivate)
  addLoadTestMiddlewares(app)

  if (rollbar) app.use(rollbar.errorHandler())

  app.use((error, req, res, next: NextFunction) => {
    const log = req.log
    log.error(error)
    res.status(400).json({ message: error.message })
  })

  const disposeEnrollmentsTask = createDisposeEnrollmentsTask(UserDBPrivate)

  CronTasksRunner.registerTask(disposeEnrollmentsTask)
  CronTasksRunner.startTasks()
}

// @flow
import express, { Router } from 'express'
import type { NextFunction } from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { version as contractsVersion } from '@gooddollar/goodcontracts/package.json'

import addLoginMiddlewares from './login/login-middleware'
import { setup as addGunMiddlewares, GunDBPublic } from './gun/gun-middleware'
import UserDBPrivate from './db/mongo/user-privat-provider'
import getTasksRunner from './cron/TaskRunner'
import addStorageMiddlewares from './storage/storageAPI'
import addVerificationMiddlewares from './verification/verificationAPI'
import addSendMiddlewares from './send/sendAPI'
import addLoadTestMiddlewares from './loadtest/loadtest-middleware'
import { addCypressMiddleware } from './cypress/cypress-middleware'
import logger, { addRequestLogger } from '../imports/logger'
import VerificationAPI from './verification/verification'
import createDisposeEnrollmentsTask from './verification/cron/DisposeEnrollmentsTask'
import addClaimQueueMiddlewares from './claimQueue/claimQueueAPI'
import { fishInactiveTask, collectFundsTask } from './blockchain/stakingModelTasks'
import Config from './server.config'

const rootLogger = logger.child({ from: 'Server' })

export default async (app: Router, env: any) => {
  const corsConfig = {
    credentials: true,
    origin: Config.env === 'production' ? /\.gooddollar\.org$/ : true
  }

  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms
  app.use(express.json({ limit: '100mb', extended: true }))
  // parse application/json
  app.use(bodyParser.json({ limit: '100mb' }))
  // parse UTM cookies
  app.use(cookieParser())
  app.use(cors(corsConfig))
  app.use(addRequestLogger)

  addCypressMiddleware(app)
  addLoginMiddlewares(app)
  addGunMiddlewares(app)
  addStorageMiddlewares(app, GunDBPublic, UserDBPrivate)
  addVerificationMiddlewares(app, VerificationAPI, GunDBPublic, UserDBPrivate)
  addSendMiddlewares(app, UserDBPrivate)
  addClaimQueueMiddlewares(app, UserDBPrivate)
  addLoadTestMiddlewares(app)

  app.use((error, req, res, next: NextFunction) => {
    const log = req.log || rootLogger
    const { message } = error

    log.error('Something went wrong while performing request', message, error, { req })

    res.status(400).json({ message })
  })

  const CronTasksRunner = getTasksRunner()
  const disposeEnrollmentsTask = createDisposeEnrollmentsTask(UserDBPrivate)

  CronTasksRunner.registerTask(disposeEnrollmentsTask)

  if (contractsVersion >= '2.0.0') {
    CronTasksRunner.registerTask(collectFundsTask)
    CronTasksRunner.registerTask(fishInactiveTask)
  }

  CronTasksRunner.startTasks()
}

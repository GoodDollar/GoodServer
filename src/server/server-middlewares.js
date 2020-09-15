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
import { addRequestLogger } from '../imports/logger'
import VerificationAPI from './verification/verification'
import createDisposeEnrollmentsTask from './verification/cron/DisposeEnrollmentsTask'
import addClaimQueueMiddlewares from './claimQueue/claimQueueAPI'
import { fishInactiveTask, collectFundsTask } from './blockchain/stakingModelTasks'
import AdminWallet from './blockchain/AdminWallet'
import requestTimeout from './utils/async'
import Config from './server.config'

export default (app: Router, env: any) => {
  Promise.race([
    requestTimeout(30000, 'gun not initialized'),
    AdminWallet.ready.then(_ => {
      const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
      //we no longer use backend also as gundb  server, otherwise this needs to be moved back
      //to server-prod.js so we can pass the express server instance instead of null
      GunDBPublic.init(null, pkey, 'publicdb')
    })
  ]).catch(e => {
    console.log('gun failed... quiting', e)
    process.exit(-1)
  })

  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms
  app.use(express.json({ limit: '100mb', extended: true }))
  // parse application/json
  app.use(bodyParser.json({ limit: '100mb' }))
  // parse UTM cookies
  app.use(cookieParser())

  const corsConfig = {
    credentials: true,
    origin: Config.env === 'production' ? /\.gooddollar\.org$/ : true
  }
  app.options(cors(corsConfig))
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
    const log = req.log
    const { message } = error

    log.error('Something went wrong while performing request', message, error)

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

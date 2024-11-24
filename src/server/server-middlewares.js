// @flow
import express, { Router } from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { version as contractsVersion } from '@gooddollar/goodcontracts/package.json'

import addLoginMiddlewares from './login/login-middleware'
import UserDBPrivate from './db/mongo/user-privat-provider'
import getTasksRunner from './cron/TaskRunner'
import addStorageMiddlewares from './storage/storageAPI'
import addVerificationMiddlewares from './verification/verificationAPI'
import addGoodIDMiddleware from './goodid/goodid-middleware'
import logger, { addRequestLogger } from '../imports/logger'
import VerificationAPI from './verification/verification'
import createDisposeEnrollmentsTask from './verification/cron/DisposeEnrollmentsTask'
import createCleanupAbandonedSignupsTask from './storage/cron/CleanupAbandonedSignups'
import StakingModelTasks from './blockchain/stakingModelTasks'
import { MessageStrings } from './db/mongo/models/props'
import Config from './server.config'
import { wrapAsync } from './utils/helpers'
import GoodIDUtils from './goodid/utils'

const { FishInactiveTask, CollectFundsTask } = StakingModelTasks
const rootLogger = logger.child({ from: 'Server' })
const { env, fishTaskDisabled, stakeTaskDisabled } = Config

const stakingModelTasks = [
  {
    task: CollectFundsTask,
    disabled: stakeTaskDisabled
  },
  {
    task: FishInactiveTask,
    disabled: fishTaskDisabled
  }
]

export default async (app: Router) => {
  const corsConfig = {
    credentials: true,
    origin:
      env === 'production'
        ? /(\.?goodd(ollar|app)\.org$)|localhost|localhost:3000|good-wallet-v2\.vercel\.app|goodwallet\.xyz/
        : true
  }

  if (env === 'production') {
    app.set('trust proxy', 1) //this is required for heroku to pass ips correctly to rate limiter
  }

  if (global.workerId === 0) {
    UserDBPrivate.unlockOnStartup()
      .then(() => logger.info('done unlocking tasks on startup'))
      .catch(e => logger.error('failed unlocking tasks on startup', e.message, e))
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
  addLoginMiddlewares(app)
  addStorageMiddlewares(app, UserDBPrivate)
  addVerificationMiddlewares(app, VerificationAPI, UserDBPrivate)
  addGoodIDMiddleware(app, GoodIDUtils, UserDBPrivate)

  app.get(
    '/strings',
    wrapAsync(async (_, res) => {
      const { value } = await MessageStrings.findOne().lean()

      res.json(value)
    })
  )

  // error handler
  app.use((error, req, res, next) => {
    const { log = rootLogger, body, url } = req
    const { message } = error
    const aborted = error.code === 'ECONNABORTED'
    const label = 'Something went wrong while performing request'

    log[aborted ? 'warn' : 'error'](label, message, error, { url, body })
    // send 'message' for compatibility
    res.status(400).json({ ok: 0, error: message, message })
    next(error)
  })

  // do not add background tasks whilte running tests
  if (env === 'test') {
    return
  }

  const CronTasksRunner = getTasksRunner()
  const cronTasksFactories = [createDisposeEnrollmentsTask]

  if (true === Config.storageCleanupEnabled) {
    cronTasksFactories.push(createCleanupAbandonedSignupsTask)
  }

  for (let taskFactory of cronTasksFactories) {
    const task = taskFactory(UserDBPrivate)

    CronTasksRunner.registerTask(task)
  }

  if (contractsVersion >= '2.0.0') {
    for (let { task, disabled } of stakingModelTasks) {
      if (disabled) {
        continue
      }

      CronTasksRunner.registerTask(new task())
    }
  }

  CronTasksRunner.startTasks()
}

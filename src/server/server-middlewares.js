// @flow
import express, { Router } from 'express'
import type { NextFunction } from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { version as contractsVersion } from '@gooddollar/goodcontracts/package.json'

import addLoginMiddlewares from './login/login-middleware'
import UserDBPrivate from './db/mongo/user-privat-provider'
import getTasksRunner from './cron/TaskRunner'
import addStorageMiddlewares from './storage/storageAPI'
import addVerificationMiddlewares from './verification/verificationAPI'
import addLoadTestMiddlewares from './loadtest/loadtest-middleware'
import logger, { addRequestLogger } from '../imports/logger'
import VerificationAPI from './verification/verification'
import createDisposeEnrollmentsTask from './verification/cron/DisposeEnrollmentsTask'
import StakingModelTasks from './blockchain/stakingModelTasks'
import { MessageStrings } from './db/mongo/models/props'
import Config from './server.config'
import { wrapAsync } from './utils/helpers'

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
    origin: env === 'production' ? /(\.gooddollar\.org$)|localhost|localhost:3000/ : true
  }

  if (env === 'production') {
    app.set('trust proxy', 1) //this is required for heroku to pass ips correctly to rate limiter
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
  addLoadTestMiddlewares(app)

  app.get(
    '/strings',
    wrapAsync(async (_, res) => {
      const { value } = await MessageStrings.findOne().lean()

      res.json(value)
    })
  )

  app.use((error, req, res, next: NextFunction) => {
    const { log = rootLogger, body, url } = req
    const { message } = error

    const aborted = error.code === 'ECONNABORTED'

    log[aborted ? 'warn' : 'error']('Something went wrong while performing request', message, error, { url, body })
    res.status(400).json({ message })
  })

  const CronTasksRunner = getTasksRunner()
  const disposeEnrollmentsTask = createDisposeEnrollmentsTask(UserDBPrivate)

  CronTasksRunner.registerTask(disposeEnrollmentsTask)

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

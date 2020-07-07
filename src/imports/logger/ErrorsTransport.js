import * as Sentry from '@sentry/node'
import Transport from 'winston-transport'
import { SPLAT } from 'triple-beam'
import { forEach } from 'lodash'
import Config from '../../server/server.config'

const { env, sentryDSN, version, network } = Config
const logEnvAllowed = !['test', 'development'].includes(env)

let sentryInitialized = false
if (logEnvAllowed && sentryDSN) {
  Sentry.init({
    dsn: sentryDSN,
    environment: env
  })

  Sentry.configureScope(scope => {
    scope.setTag('appVersion', version)
    scope.setTag('networkUsed', network)
  })

  sentryInitialized = true
}

export default class ErrorsTransport extends Transport {
  // eslint-disable-next-line
  constructor(opts) {
    super(opts)
  }

  log(context) {
    const { message: generalMessage, userId, ...data } = context
    const [errorMessage, errorObj, extra = {}] = context[SPLAT]
    const dataToPassIntoLog = { generalMessage, errorMessage, errorObj, ...extra, ...data }
    let errorToPassIntoLog = errorObj

    if (errorObj instanceof Error) {
      errorToPassIntoLog.message = `${generalMessage}: ${errorObj.message}`
    } else {
      errorToPassIntoLog = new Error(generalMessage)
    }

    if (sentryInitialized) {
      Sentry.configureScope(scope => {
        scope.setUser({
          userId
        })

        forEach(dataToPassIntoLog, (value, key) => {
          scope.setExtra(key, value)
        })
      })

      Sentry.captureException(errorToPassIntoLog)
    }
  }
}

import * as Sentry from '@sentry/node'
import { RewriteFrames } from '@sentry/integrations'
import Transport from 'winston-transport'
import { SPLAT } from 'triple-beam'
import { forEach } from 'lodash'
import cloneError from '../../server/utils/cloneError'

import Config from '../../server/server.config'

export default class ErrorsTransport extends Transport {
  sentryInitialized = false

  static factory = options => new ErrorsTransport(options, Config, Sentry)

  constructor(opts, Config, Sentry) {
    const { env, sentryDSN, version, network, remoteLoggingAllowed } = Config

    super(opts)

    if (remoteLoggingAllowed && sentryDSN) {
      Sentry.init({
        dsn: sentryDSN,
        environment: env,
        release: version,
        integrations: [new RewriteFrames()]
      })

      Sentry.configureScope(scope => {
        scope.setTag('appVersion', version)
        scope.setTag('networkUsed', network)
      })

      this.sentryInitialized = true
    }
  }

  log(context) {
    const { message: generalMessage, userId, ...data } = context

    // context[SPLAT] could be undefined in case if just one argument passed to the error log
    // i.e log.error('some error message')
    const [errorMessage, errorObj, extra = {}] = context[SPLAT] || []
    const dataToPassIntoLog = { generalMessage, errorMessage, errorObj, ...extra, ...data }

    // we cannot modify the origin errorObj - need to clone it
    // otherwise modification in this fn will cause some unexpected behavior in place from where it was called
    let errorToPassIntoLog = cloneError(errorObj)

    if (errorObj instanceof Error) {
      errorToPassIntoLog.message = `${generalMessage}: ${errorObj.message}`
    } else {
      errorToPassIntoLog = new Error(generalMessage)
    }

    if (this.sentryInitialized) {
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

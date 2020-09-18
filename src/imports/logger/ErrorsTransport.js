import * as Sentry from '@sentry/node'
import { RewriteFrames } from '@sentry/integrations'
import Transport from 'winston-transport'
import { SPLAT } from 'triple-beam'
import { forEach, trimEnd } from 'lodash'

import Config from '../../server/server.config'

export default class ErrorsTransport extends Transport {
  sentryInitialized = false

  static factory = options => new ErrorsTransport(options, Config, Sentry)

  constructor(opts, Config, Sentry) {
    const { env, sentryDSN, version, network, remoteLoggingAllowed } = Config

    super(opts)

    if (!remoteLoggingAllowed || !sentryDSN) {
      return
    }

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

  log(context, callback) {
    setImmediate(() => {
      this.emit('logged', context)
    })

    if (!this.sentryInitialized) {
      callback()
      return
    }

    const { message: generalMessage, userId, ...data } = context

    // context[SPLAT] could be undefined in case if just one argument passed to the error log
    // i.e log.error('some error message')
    const [errorMessage, errorObj = new Error(), extra = {}] = context[SPLAT] || []
    const dataToPassIntoLog = { generalMessage, errorMessage, errorObj, ...extra, ...data }

    errorObj.message = `${trimEnd(generalMessage, ' :')}: ${errorObj.message}`

    Sentry.configureScope(scope => {
      scope.setUser({
        userId
      })

      forEach(dataToPassIntoLog, (value, key) => {
        scope.setExtra(key, value)
      })
    })

    Sentry.captureException(errorObj)
    callback()
  }
}

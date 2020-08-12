import { isError, isString, assign } from 'lodash'

export const addLoggerMonitor = logger => {
  const log = logger.child({ from: 'GoodServer' })

  // add logging of deprecation errors
  process.on('deprecation', deprecationError => {
    const { message } = deprecationError

    log.warn('Deprecation error:', message, deprecationError)
  })

  // add logging of warnings
  process.on('warning', warning => {
    const { message } = warning

    log.warn('Warning:', message, warning)
  })

  // add logging of uncaught exceptions
  process.on('uncaughtExceptionMonitor', (exception, origin) => {
    const { message } = exception

    log.error('Uncaught exception at:', message, exception, { origin })
  })

  // add logging of unhandled promise rejections
  process.on('unhandledRejection', reason => {
    let message = ''
    let logPayload = {}
    let exception = reason
    const label = 'Unhandled promise rejection'

    if (isError(reason)) {
      message = reason.message
    } else {
      if (isString(reason)) {
        message = reason
      } else {
        logPayload = { reason }
      }

      exception = new Error(message || label)
    }

    log.error(`${label} at:`, message, exception, logPayload)
  })
}

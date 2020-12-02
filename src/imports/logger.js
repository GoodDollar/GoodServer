// libraries
import winston from 'winston'
import { mapValues } from 'lodash'

// configs
import ErrorsTransport from './logger/ErrorsTransport'
import conf from '../server/server.config'

import { levelConfigs } from './logger/options'
import { extended } from './logger/formatter'
import { createLoggerMiddleware } from './logger/middleware'
import { addLoggerMonitor } from './logger/monitor'

const { combine, timestamp, errors } = winston.format
const { env, logLevel } = conf

console.log('Starting logger', { logLevel, env })

const transports = [
  new winston.transports.Console({
    silent: logLevel === 'silent'
  }),
  ErrorsTransport.factory({ level: 'error' })
]

const logger = winston.createLogger({
  transports,
  level: logLevel,
  levels: levelConfigs.levels,
  format: combine(timestamp(), errors({ stack: true }), extended())
})

winston.addColors(levelConfigs.colors)

/**
 * Sets log middleware
 */
export const addRequestLogger = createLoggerMiddleware(logger)

// add logging of the global events (errors, warning, deprecations, unhandled rejections )
addLoggerMonitor(logger)

// print memory fn
const printMemory = () => {
  const used = process.memoryUsage()

  logger.debug(
    'Memory usage:',
    mapValues(used, value => `${Math.round(value / (1 << 20), 2)} MB`)
  )
}

if ('test' !== env) {
  setInterval(printMemory, 30000)
}

export default logger

// libraries
import winston from 'winston'
import { omit, isPlainObject, mapValues } from 'lodash'
import Crypto from 'crypto'

// configs
import ErrorsTransport from './logger/ErrorsTransport'
import conf from '../server/server.config'

import { levelConfigs } from './logger/options'
import { extended } from './logger/formatter'

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
export const addRequestLogger = (req, res, next) => {
  const startTime = Date.now()
  let uuid = Math.random() + ' ' + startTime
  uuid = Crypto.createHash('sha1')
    .update(uuid)
    .digest('base64')
    .slice(0, 10)

  req.log = logger.child({ uuid, from: req.url, userId: req.user && req.user.identifier })
  res.on('finish', () => {
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let logBody = req.body

    if (req.url.startsWith('/verify/face/') && isPlainObject(logBody)) {
      logBody = omit(logBody, 'faceMap', 'auditTrailImage', 'lowQualityAuditTrailImage')
    }

    req.log.log('http', 'Incoming Request', {
      responseTimeSeconds,
      method: req.method,
      body: logBody,
      query: req.query,
      headers: req.headers
    })
  })
  next()
}

// add logging of the deprecation errors
process.on('deprecation', exception => {
  const { message } = exception

  logger.error('Deprecation error:', message, exception)
})

// print memory fn
const printMemory = () => {
  const used = process.memoryUsage()

  logger.debug('Memory usage:', mapValues(used, value => `${Math.round(value / (1 << 20), 2)} MB`))
}

if ('test' !== env) {
  setInterval(printMemory, 30000)
}

export default logger

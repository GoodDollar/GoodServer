// libraries
import winston from 'winston'
import { omit, isPlainObject, isError, mapKeys } from 'lodash'
import Crypto from 'crypto'
import { SPLAT } from 'triple-beam'

// configs
import ErrorsTransport from './loggerUtils/ErrorsTransport'
import conf from '../server/server.config'

const { format } = winston
const { combine, printf, timestamp } = format
const colorizer = format.colorize()

const { env, logLevel } = conf

console.log('Starting logger', { logLevel, env })

const levelConfigs = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
    trace: 5
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'cyan',
    debug: 'green',
    trace: 'white',
    http: 'bold green'
  }
}

const formatLogValue = value => {
  if (!isError(value)) {
    return value
  }

  const { name, message, stack } = value

  return `${name}: ${message}\n${stack}`
}

const logger = winston.createLogger({
  levels: levelConfigs.levels,
  level: logLevel,
  format: combine(
    timestamp(),
    format.errors({ stack: true }),
    printf(({ level, timestamp, from, userId, ...rest }) => {
      const logPayload = mapKeys(rest, (_, key) => (key === SPLAT ? 'context' : key))
      const stringifiedPayload = JSON.stringify(logPayload, (_, logValue) => formatLogValue(logValue))

      return colorizer.colorize(
        level,
        `${timestamp} - ${level}${from ? ` (FROM ${from} ${userId || ''})` : ''}: ${stringifiedPayload}`
      )
    })
  ),
  transports: [
    new winston.transports.Console({
      silent: logLevel === 'silent'
    }),
    ErrorsTransport.factory({ level: 'error' })
  ]
})

winston.addColors(levelConfigs.colors)

// set log middleware
const addRequestLogger = (req, res, next) => {
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

// print memory fn
const printMemory = () => {
  const used = process.memoryUsage()
  let toPrint = {}
  for (let key in used) {
    toPrint[key] = `${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
  }
  logger.debug('Memory usage:', toPrint)
}
if (env !== 'test') setInterval(printMemory, 30000)

export { addRequestLogger, logger as default }

import winston from 'winston'
import { omit, isPlainObject } from 'lodash'
import conf from '../server/server.config'
import Rollbar from 'rollbar'
import Crypto from 'crypto'

const { format } = winston
const { combine, printf, timestamp } = format
const colorizer = format.colorize()

let rollbar
if (conf.env !== 'development' && conf.rollbarToken)
  rollbar = new Rollbar({
    accessToken: conf.rollbarToken,
    captureUncaught: true,
    captureUnhandledRejections: true,
    payload: {
      environment: process.env.NODE_ENV
    }
  })

const LOG_LEVEL = conf.logLevel

console.log('Starting logger', { LOG_LEVEL, env: conf.env })

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

const logger = winston.createLogger({
  levels: levelConfigs.levels,
  level: LOG_LEVEL,
  format: combine(
    timestamp(),
    format.errors({ stack: true }),
    printf(({ level, timestamp, from, userId, ...rest }) =>
      colorizer.colorize(
        level,
        `${timestamp} - ${level}${from ? ` (FROM ${from} ${userId || ''})` : ''}:  ${JSON.stringify(rest)}`
      )
    )
  ),
  transports: [
    new winston.transports.Console({
      silent: LOG_LEVEL === 'silent'
    })
    // new winston.transports.File({ filename: 'somefile.log' })
  ]
})

winston.addColors(levelConfigs.colors)

// patch error
const error = logger.error
logger.error = function() {
  if (rollbar && conf.env !== 'test') rollbar.error.apply(rollbar, arguments)

  error.apply(this, arguments)
}

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
if (conf.env !== 'test') setInterval(printMemory, 30000)

export { rollbar, addRequestLogger, logger as default }

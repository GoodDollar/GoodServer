// libraries
import winston from 'winston'
import errorSerializer from 'pino-std-serializers/lib/err'
import { omit, isPlainObject, isError } from 'lodash'
import Crypto from 'crypto'
import { SPLAT } from 'triple-beam'

// configs
import ErrorsTransport from './logger/ErrorsTransport'
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
  format: combine(
    timestamp(),
    format.errors({ stack: true }),
    printf(({ level, timestamp, from, userId, ...rest }) => {
      const logPayload = { ...rest, context: rest[SPLAT] }
      const stringifiedPayload = JSON.stringify(logPayload, (_, value) =>
        isError(value) ? errorSerializer(value) : value
      )
      return colorizer.colorize(
        level,
        `${timestamp} - workerId:${global.workerId} - ${level}${
          from ? ` (FROM ${from} ${userId || ''})` : ''
        }: ${stringifiedPayload}`
      )
    })
  )
})

winston.addColors(levelConfigs.colors)

Object.defineProperty(logger.constructor.prototype, 'async', {
  get() {
    let { _asyncProxy } = this

    if (!_asyncProxy) {
      const _transports = transports.filter(({ silent }) => true !== silent)

      _asyncProxy = new Proxy(this, {
        get: (target, method) => async (...args) => {
          const promise = Promise.all(
            _transports.map(transport => new Promise(resolve => transport.once('logged', resolve)))
          )

          target[method](...args)
          return promise
        }
      })

      this._asyncProxy = _asyncProxy
    }

    return _asyncProxy
  }
})

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

export default logger

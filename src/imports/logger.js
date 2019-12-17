import winston from 'winston'
import conf from '../server/server.config'
import Rollbar from 'rollbar'

const { format } = winston
const { combine, printf, timestamp } = format
const colorizer = format.colorize()

let rollbar
if (conf.env != 'development' && conf.rollbarToken)
  rollbar = new Rollbar({
    accessToken: conf.rollbarToken,
    captureUncaught: true,
    captureUnhandledRejections: true,
    payload: {
      environment: process.env.NODE_ENV
    }
  })

const LOG_LEVEL = conf.logLevel || 'debug'

console.log('Starting logger', { LOG_LEVEL, env: conf.env })

const logger = winston.createLogger({
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  },
  level: LOG_LEVEL,
  format: combine(
    timestamp(),
    printf(({ level, timestamp, from, ...rest }) =>
      colorizer.colorize(level, `${timestamp} - ${level} ${from && `(FROM ${from})`}:  ${JSON.stringify(rest)}`)
    )
  ),
  transports: [
    new winston.transports.Console({
      silent: LOG_LEVEL === 'silent'
    })
    // new winston.transports.File({ filename: 'somefile.log' })
  ]
})

winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'blue',
  debug: 'green'
})

// patch error
const error = logger.error
logger.error = function() {
  if (rollbar && conf.env !== 'test') rollbar.error.apply(rollbar, arguments)

  error.apply(this, arguments)
}

// set log middleware
const setLogMiddleware = (req, res, next) => {
  req.log = logger
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

export { rollbar, setLogMiddleware, logger as default }

// import pino from 'pino'
import Rollbar from 'rollbar'
const rollbar = new Rollbar({
  accessToken: '9d72fbbedc434c03995f186846f0a126',
  captureUncaught: true,
  captureUnhandledRejections: true
})
const pino = require('pino')
const env = require('dotenv').config()

const LOG_LEVEL = env.error ? 'trace' : env.parsed.LOG_LEVEL
console.log('env', env)
const logger = pino({
  name: 'GoodDollar - Server',
  level: LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization'],
    censor: '*** private data ***'
  }
})
let error = logger.error
logger.error = function() {
  if (rollbar && env.NODE_ENV !== 'test') rollbar.error.apply(rollbar, arguments)
  return error.apply(logger, arguments)
}
export { rollbar, logger as default }

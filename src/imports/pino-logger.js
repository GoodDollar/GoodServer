import pino from 'pino'
import Rollbar from 'rollbar'
import conf from '../server/server.config'
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
const LOG_LEVEL = conf.logLevel || 'debug'
console.log('Starting logger', { LOG_LEVEL, env: conf.env })
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
  if (rollbar && conf.env !== 'test') rollbar.error.apply(rollbar, arguments)
  return error.apply(logger, arguments)
}
const printMemory = () => {
  const used = process.memoryUsage()
  let toPrint = {}
  for (let key in used) {
    toPrint[key] = `${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
  }
  logger.debug('Memory usage:', toPrint)
}
if (conf.env !== 'test') setInterval(printMemory, 30000)
export { rollbar, logger as default }

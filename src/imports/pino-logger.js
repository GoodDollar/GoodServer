// import pino from 'pino'
const pino = require('pino')
const env = require('dotenv').config()

const LOG_LEVEL = env.error ? 'trace' : env.parsed.LOG_LEVEL

export default pino({
  name: 'GoodDollar - Server',
  level: LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization'],
    censor: '*** private data ***'
  }
})

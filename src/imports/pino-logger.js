// import pino from 'pino'
const pino = require('pino')

export default pino({
  name: 'GoodDollar - Server',
  level: 'trace', // trace (10), debug (20), info (30), warn (40), error (50), fatal (60)
  redact: {
    paths: ['req.headers.authorization'],
    censor: '*** private data ***'
  },
})

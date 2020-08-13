import express from 'express'

import middlewares from './server-middlewares'
import { EventEmitter } from 'events'

EventEmitter.defaultMaxListeners = 100
// we're logging uncaught exceptions in logger monitor so just exiting process
process.on('uncaughtException', () => process.exit(-1))

const startApp = () => {
  const app = express()

  app.use(express.static('public'))
  middlewares(app, 'prod')
  return app
}

export default startApp

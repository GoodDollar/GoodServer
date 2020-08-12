import express from 'express'
import middlewares from './server-middlewares'
import { EventEmitter } from 'events'

EventEmitter.defaultMaxListeners = 100

const startApp = () => {
  if (process.env.NODE_ENV !== 'test') {
    process.on('uncaughtException', (err, origin) => {
      console.log(`Uncaught exception: ${err}\nException origin: ${origin}`)
      process.exit(-1)
    })

    process.on('unhandledRejection', (reason, promise) => {
      console.log('Unhandled Rejection at:', promise, 'reason:', reason)
      // Application specific logging, throwing an error, or other logic here
    })
  }

  const app = express()

  app.use(express.static('public'))
  middlewares(app, 'prod')
  return app
}

export default startApp

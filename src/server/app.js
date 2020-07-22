import express from 'express'
import middlewares from './server-middlewares'
const startApp = () => {
  const app = express()

  app.use(express.static('public'))
  middlewares(app, 'prod')
  return app
}

export default startApp

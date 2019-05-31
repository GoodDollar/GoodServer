import path from 'path'
import express from 'express'
import middlewares from './server-middlewares'
const app = express()
require('newrelic')

app.use(express.static('public'))
middlewares(app, 'prod')

export default app

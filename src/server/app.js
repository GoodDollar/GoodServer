import path from 'path'
import express from 'express'
import middlewares from './server-middlewares'
const app = express()

middlewares(app, 'prod')

export default app

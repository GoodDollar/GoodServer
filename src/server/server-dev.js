/* eslint-disable import/no-extraneous-dependencies */
import path from "path"
import express from "express"
import webpack from "webpack"
import pino from 'express-pino-logger'
import webpackDevMiddleware from "webpack-dev-middleware"
import webpackHotMiddleware from "webpack-hot-middleware"
import middlewares from "./server-middlewares"
import config from "../../webpack.dev.config"
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import logger from '../imports/pino-logger'


const app = express();


const DIST_DIR = __dirname;


const HTML_FILE = path.join(DIST_DIR, "index.html");


const compiler = webpack(config)

// app.use(webpackDevMiddleware(compiler, {
//   publicPath: config.output.publicPath
// }))

app.use(pino({ logger }))

app.use(webpackHotMiddleware(compiler))

middlewares(app, "dev")
// app.get("*", (req, res, next) => {
//   compiler.outputFileSystem.readFile(HTML_FILE, (err, result) => {
//     if (err) {
//       return next(err)
//     }
//     res.set("content-type", "text/html")
//     res.send(result)
//     res.end()
//     return false
//   })
// })

logger.debug({ conf })
const PORT = conf.port || 8080

const server = app.listen(PORT, () => {
  logger.info(`App listening to ${PORT}....`)
  logger.info('Press Ctrl+C to quit.')
})
GunDBPublic.init(server, conf.gundbPassword, 'publicdb')

/* eslint-disable import/no-extraneous-dependencies */
import throng from 'throng'
import 'newrelic'
import webpack from 'webpack'
import webpackHotMiddleware from 'webpack-hot-middleware'
import config from '../../webpack.dev.config'
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'

function start(workerId) {
  const app = require('./app').default

  process.on('uncaughtException', (err, origin) => {
    console.log(`Caught exception: ${err}\n` + `Exception origin: ${origin}`)
    console.log(err.stack)
    process.exit(-1)
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason)
    // Application specific logging, throwing an error, or other logic here
  })
  const compiler = webpack(config)
  // app.use(webpackDevMiddleware(compiler, {
  //   publicPath: config.output.publicPath
  // }))

  app.use(webpackHotMiddleware(compiler))

  // const DIST_DIR = __dirname
  // const HTML_FILE = path.join(DIST_DIR, 'index.html')
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

  console.log({ conf })
  const PORT = conf.port || 8080

  const server = app.listen(PORT, () => {
    console.log(`App listening to ${PORT}....`)
    console.log('Press Ctrl+C to quit.')
  })
  GunDBPublic.init(server, conf.gundbPassword, `publicdb${workerId}`, conf.gunPublicS3).catch(e => {
    console.error(e)
    process.exit(-1)
  })
}

console.log('webConcurrency from env', process.env.WEB_CONCURRENCY)
console.log('webConcurrency from config', conf.webConcurrency)

const workers = process.env.WEB_CONCURRENCY || conf.webConcurrency
throng({ workers, lifetime: Infinity }, start)

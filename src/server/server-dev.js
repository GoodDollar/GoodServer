/* eslint-disable import/no-extraneous-dependencies */
import path from 'path'
import webpack from 'webpack'
import webpackDevMiddleware from 'webpack-dev-middleware'
import webpackHotMiddleware from 'webpack-hot-middleware'
import config from '../../webpack.dev.config'
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import AdminWallet from './blockchain/AdminWallet'
import app from './app'

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
GunDBPublic.init(server, conf.gundbPassword, 'publicdb')

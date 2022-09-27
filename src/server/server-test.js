/* eslint-disable import/no-extraneous-dependencies */
// import path from 'path'
// import webpack from 'webpack'
// import webpackDevMiddleware from 'webpack-dev-middleware'
// import webpackHotMiddleware from 'webpack-hot-middleware'
// import config from '../../webpack.dev.config'
import conf from './server.config'
import AdminWallet from './blockchain/AdminWallet'
import mongoose from './db/mongo-db'
import startApp from './app'

const PORT = conf.port || 4000

const makeServer = async done => {
  const app = await startApp()
  let server
  let serverPromise = new Promise(async (res, rej) => {
    server = app.listen(PORT, err => {
      console.log(`App listening to ${PORT}....`)
      if (err) rej(err)
      else res()
    })
    await AdminWallet.ready
  })
  serverPromise
    .then(() => mongoose.connection.readyState)
    .then(() => {
      setTimeout(done, 1000)
      console.log('make server ready')
    })

  return server
}
export default makeServer

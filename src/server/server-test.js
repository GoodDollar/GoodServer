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

const PORT = conf.port || 4000

const makeServer = done => {
  const server = app.listen(PORT, err => {
    console.log(`App listening to ${PORT}....`)
    // Delay to wait until gun middleware and wallet are ready
    setTimeout(done, 1000)
  })

  GunDBPublic.init(server, conf.gundbPassword, 'publicdb')

  return server
}
export default makeServer

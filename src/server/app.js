import express from 'express'
import { EventEmitter } from 'events'

import middlewares from './server-middlewares'
import AdminWallet from './blockchain/AdminWallet'
import { withTimeout } from './utils/async'
import conf from './server.config'

import logger from '../imports/logger'

const log = logger.child({ from: 'startapp' })

EventEmitter.defaultMaxListeners = 100
// we're logging uncaught exceptions in logger monitor so just exiting process
process.on('uncaughtException', () => process.exit(-1))

const startApp = async () => {
  await withTimeout(
    AdminWallet.ready.then(() => {
      log.info('AdminWallet ready', { addresses: AdminWallet.addresses })
    }),
    30000,
    'wallet not initialized'
  ).catch(e => {
    if (conf.env === 'test') {
      return
    }

    console.log('wallet failed... quiting', e)
    process.exit(-1)
  })

  const app = express()

  app.use(express.static('public'))
  middlewares(app)
  return app
}

export default startApp

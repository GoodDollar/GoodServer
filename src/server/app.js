import express from 'express'
import { EventEmitter } from 'events'

import middlewares from './server-middlewares'
import AdminWallet from './blockchain/AdminWallet'
import CeloWallet from './blockchain/CeloAdminWallet'

import { withTimeout } from './utils/async'
import conf from './server.config'

import logger from '../imports/logger'
import { map } from 'lodash'

const log = logger.child({ from: 'startapp' })

EventEmitter.defaultMaxListeners = 100

// we're logging uncaught exceptions in logger monitor so just exiting process
process.on('uncaughtException', () => process.exit(-1))

const startApp = async () => {
  await withTimeout(Promise.all(map([CeloWallet, AdminWallet], 'ready')), 30000, 'wallet not initialized')
    .then(() => {
      log.info('AdminWallet ready', { addresses: AdminWallet.addresses })
    })
    .catch(e => {
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

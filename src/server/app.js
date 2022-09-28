import express from 'express'
import { EventEmitter } from 'events'

import middlewares from './server-middlewares'
import MultiWallet from './blockchain/MultiWallet'

import { withTimeout } from './utils/async'
import conf from './server.config'

import logger from '../imports/logger'

const log = logger.child({ from: 'startapp' })

EventEmitter.defaultMaxListeners = 100

// we're logging uncaught exceptions in logger monitor so just exiting process
process.on('uncaughtException', () => process.exit(-1))

const startApp = async () => {
  await withTimeout(MultiWallet.ready, 30000, 'wallet not initialized')
    .then(addresses => {
      log.info('AdminWallet ready', { addresses })
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

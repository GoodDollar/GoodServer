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

const startWallet = async () => {
  const isTest = conf.env === 'test'

  try {
    const addresses = await withTimeout(MultiWallet.ready, 60000, 'wallet not initialized')

    log.info('AdminWallet ready', { addresses })
  } catch (e) {
    console.log('wallet failed...' + (isTest ? '' : ' quiting'), e)

    if (!isTest) {
      process.exit(-1)
    }
  }
}

const startApp = async () => {
  const app = express()

  startWallet()
  log.info('Wallet started, initializing middlewares')
  app.use(express.static('public'))
  middlewares(app)

  return app
}

export default startApp

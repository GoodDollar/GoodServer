import express from 'express'
import { EventEmitter } from 'events'

import middlewares from './server-middlewares'
import AdminWallet from './blockchain/AdminWallet'
import requestTimeout from './utils/timeout'
import { GunDBPublic } from './gun/gun-middleware'

EventEmitter.defaultMaxListeners = 100
// we're logging uncaught exceptions in logger monitor so just exiting process
process.on('uncaughtException', () => process.exit(-1))

const startApp = async () => {
  await Promise.race([
    requestTimeout(30000, 'gun not initialized'),
    AdminWallet.ready.then(() => {
      // const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
      // //we no longer use backend also as gundb  server, otherwise this needs to be moved back
      // //to server-prod.js so we can pass the express server instance instead of null
      // GunDBPublic.init(null, pkey, 'publicdb')
    })
  ]).catch(e => {
    console.log('gun failed... quiting', e)
    process.exit(-1)
  })

  const app = express()

  app.use(express.static('public'))
  middlewares(app, 'prod')
  return app
}

export default startApp

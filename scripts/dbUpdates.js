//@flow
import { sha3 } from 'web3-utils'
import UserPrivateModel from '../src/server/db/mongo/models/user-private.js'
import PropsModel from '../src/server/db/mongo/models/props.js'
import { get } from 'lodash'
import logger from '../src/imports/logger'
import { type UserRecord } from '../src/imports/types'

class DBUpdates {
  async runUpgrades() {
    return this.upgrade()
      .then(_ => logger.info('upgrade done'))
      .catch(e => logger.error('upgrade failed', { err: e.message, e }))
  }
  async upgrade() {
    const dbversion = await PropsModel.findOne({ name: 'DATABASE_VERSION' })
    logger.info({ dbversion })
    const version = get(dbversion, 'value.version', 0)
    if (version < 1) {
      const docs = await UserPrivateModel.find()
      const ops = docs
        .filter(doc => doc.email || doc.mobile)
        .filter(doc => (doc.email && doc.email.indexOf('0x') === -1) || (doc.mobile && doc.mobile.indexOf('0x') === -1))
        .map(doc => {
          const res = {
            updateOne: {
              filter: { _id: doc._id },
              update: { mobile: doc.mobile && sha3(doc.mobile), email: doc.email && sha3(doc.email), otp: null }
            }
          }
          return res
        })
      const res = await UserPrivateModel.bulkWrite(ops)
      logger.info('upgrade v1', res)
      await PropsModel.updateOne({ name: 'DATABASE_VERSION' }, { $set: { value: { version: 1 } } }, { upsert: true })
    }
  }
}
if (process.env.NODE_ENV === 'test') process.exit(0)
const updater = new DBUpdates()
updater
  .runUpgrades()
  .then(_ => process.exit(0))
  .catch(_ => process.exit(-1))

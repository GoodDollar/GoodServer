//@flow
import { sha3 } from 'web3-utils'
import { get, delay } from 'lodash'
import logger from '../src/imports/logger'
import { type UserRecord } from '../src/imports/types'
import { GunDBPublic } from '../src/server/gun/gun-middleware'
import conf from '../src/server/server.config'
if (process.env.NODE_ENV === 'test') process.exit(0)

const UserPrivateModel = require('../src/server/db/mongo/models/user-private.js')
const PropsModel = require('../src/server/db/mongo/models/props.js')
class DBUpdates {
  async runUpgrades() {
    return Promise.all([
      this.upgrade()
        .then(_ => logger.info('upgrade done'))
        .catch(e => logger.error('upgrade failed', { err: e.message, e })),
      this.upgradeGun()
        .then(_ => logger.info('gun upgrade done'))
        .catch(e => logger.error('gun upgrade failed', { err: e.message, e }))
    ])
  }
  async upgradeGun() {
    await GunDBPublic.init(null, conf.gundbPassword, `publicdb0`, null)
    let ps = []
    GunDBPublic.gun.get('users/bywalletAddress').once(data => {
      const updatedIndex = {}
      Object.keys(data).forEach(k => {
        if (data[k] == null || k === '_') return
        updatedIndex[sha3(k)] = data[k]
      })
      ps.push(GunDBPublic.gun.get('users/bywalletAddress').putAck(updatedIndex))
    })
    GunDBPublic.gun.get('users/bymobile').once(data => {
      const updatedIndex = {}
      Object.keys(data).forEach(k => {
        if (data[k] == null || k === '_') return
        updatedIndex[sha3(k)] = data[k]
      })
      ps.push(GunDBPublic.gun.get('users/bymobile').putAck(updatedIndex))
    })
    GunDBPublic.gun.get('users/byemail').once(data => {
      const updatedIndex = {}
      Object.keys(data).forEach(k => {
        if (data[k] == null || k === '_') return
        updatedIndex[sha3(k)] = data[k]
      })
      ps.push(GunDBPublic.gun.get('users/byemail').putAck(updatedIndex))
    })
    return new Promise((res, rej) => {
      delay(
        () =>
          Promise.all(ps)
            .then(res)
            .catch(rej),
        5000
      )
    })
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

const updater = new DBUpdates()
updater
  .runUpgrades()
  .then(_ => process.exit(0))
  .catch(_ => process.exit(-1))

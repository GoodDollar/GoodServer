//@flow
import { sha3 } from 'web3-utils'
import { get, delay } from 'lodash'
import logger from '../src/imports/logger'
import { type UserRecord } from '../src/imports/types'
import { GunDBPublic } from '../src/server/gun/gun-middleware'
import conf from '../src/server/server.config'
console.log(conf, process.env.NODE_ENV, process.env.TRAVIS)
if (process.env.NODE_ENV === 'test' || process.env.TRAVIS === 'true') process.exit(0)

const UserPrivateModel = require('../src/server/db/mongo/models/user-private.js').default
const PropsModel = require('../src/server/db/mongo/models/props.js').default
class DBUpdates {
  async runUpgrades() {
    const dbversion = await PropsModel.findOne({ name: 'DATABASE_VERSION' })
    const version = get(dbversion, 'value.version', 0)
    if (version < 1) {
      await Promise.all([
        this.upgrade()
          .then(_ => logger.info('upgrade done'))
          .catch(e => {
            logger.error('upgrade failed', { err: e.message, e })
            throw e
          }),
        this.upgradeGun()
          .then(_ => logger.info('gun upgrade done'))
          .catch(e => {
            logger.error('gun upgrade failed', { err: e.message, e })
            throw e
          })
      ])
      await PropsModel.updateOne({ name: 'DATABASE_VERSION' }, { $set: { value: { version: 1 } } }, { upsert: true })
    }
  }

  /**
   * convert existing gun indexes to hash based, also add them to the trusted index under our profile
   */
  async upgradeGun() {
    await GunDBPublic.init(null, conf.gundbPassword, `publicdb0`, null)
    const gooddollarProfile = '~' + GunDBPublic.user.is.pub
    logger.info('GoodDollar profile id:', { gooddollarProfile })
    let ps = []
    GunDBPublic.gun.get('users/bywalletAddress').once(
      data => {
        const updatedIndex = {}
        Object.keys(data || {}).forEach(k => {
          if (data[k] == null || k === '_') return
          updatedIndex[sha3(k)] = data[k]
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to bywalletAddress`)
        ps.push(GunDBPublic.gun.get('users/bywalletAddress').putAck(updatedIndex))
        ps.push(GunDBPublic.user.get('users/bywalletAddress').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
    GunDBPublic.gun.get('users/bymobile').once(
      data => {
        const updatedIndex = {}
        Object.keys(data || {}).forEach(k => {
          if (data[k] == null || k === '_') return
          updatedIndex[sha3(k)] = data[k]
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to bymobile`)
        ps.push(GunDBPublic.gun.get('users/bymobile').putAck(updatedIndex))
        ps.push(GunDBPublic.user.get('users/bymobile').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
    GunDBPublic.gun.get('users/byemail').once(
      data => {
        const updatedIndex = {}
        Object.keys(data || {}).forEach(k => {
          if (data[k] == null || k === '_') return
          updatedIndex[sha3(k)] = data[k]
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to byemail`)
        ps.push(GunDBPublic.gun.get('users/byemail').putAck(updatedIndex))
        ps.push(GunDBPublic.user.get('users/byemail').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
    return new Promise((res, rej) => {
      delay(() => Promise.all(ps).then(res).catch(rej), 5000)
    })
  }

  async upgrade() {
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
    if (ops.length > 1) {
      const res = await UserPrivateModel.bulkWrite(ops)
      logger.info('upgraded mongodb', res)
    } else {
      logger.warn('upgrade mongodb. nothing to do')
    }
  }
}

const updater = new DBUpdates()
updater
  .runUpgrades()
  .then(_ => {
    console.log('dbUpdates done')
    process.exit(0)
  })
  .catch(e => {
    console.log('dbUpdates failed:', { e })
    process.exit(-1)
  })

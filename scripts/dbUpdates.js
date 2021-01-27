//@flow
import Gun from '@gooddollar/gun'
import { sha3 } from 'web3-utils'
import { delay, chunk, flattenDeep } from 'lodash'
import logger from '../src/imports/logger'
import { type UserRecord } from '../src/imports/types'
import { GunDBPublic } from '../src/server/gun/gun-middleware'
import AdminWallet from '../src/server/blockchain/AdminWallet'

import conf from '../src/server/server.config'

console.log(conf, process.env.NODE_ENV, process.env.TRAVIS)
if (process.env.NODE_ENV === 'test' || process.env.TRAVIS === 'true') process.exit(0)

const { default: UserPrivateModel } = require('../src/server/db/mongo/models/user-private')
const { DatabaseVersion } = require('../src/server/db/mongo/models/props')
const { default: DelayedTaskModel } = require('../src/server/db/mongo/models/delayed-task')

class DBUpdates {
  async runUpgrades() {
    let dbversion = await DatabaseVersion.findOne({})

    if (!dbversion) {
      dbversion = new DatabaseVersion({ value: { version: 0 } })
    }

    const { version } = dbversion.value
    // await this.testWrite()
    logger.info('runUpgrades:', { version })
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

      dbversion.value.version = 1
      await dbversion.save()
    }

    if (version >= 1 && version < 2) {
      await this.fixGunTrustProfiles()
        .then(_ => logger.info('gun fixGunTrustProfiles done', { results: _ }))
        .catch(e => {
          logger.error('gun fixGunTrustProfiles failed', { err: e.message, e })
          throw e
        })

      dbversion.value.version = 2
      await dbversion.save()
    }

    if (version >= 2 && version < 3) {
      await DelayedTaskModel.updateMany({}, [
        {
          $set: { 'subject.enrollmentIdentifier': { $toLower: '$subject.enrollmentIdentifier' } }
        }
      ])

      dbversion.value.version = 3
      await dbversion.save()
    }
  }

  async testWrite() {
    await AdminWallet.ready
    const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
    await GunDBPublic.init(null, pkey, `publicdb0`)
    await GunDBPublic.gun.get('users/bywalletAddress').putAck({ version: Date.now() })
  }
  /**
   * convert existing gun indexes to hash based, also add them to the trusted index under our profile
   */
  async upgradeGun() {
    await AdminWallet.ready
    const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
    await GunDBPublic.init(null, pkey, `publicdb0`, null)
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
        if (Object.keys(updatedIndex).length === 0) return
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
        if (Object.keys(updatedIndex).length === 0) return
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
        if (Object.keys(updatedIndex).length === 0) return
        ps.push(GunDBPublic.gun.get('users/byemail').putAck(updatedIndex))
        ps.push(GunDBPublic.user.get('users/byemail').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
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

  /**
   * convert existing gun indexes to hash based, also add them to the trusted index under our profile
   */
  async fixGunTrustProfiles() {
    await AdminWallet.ready
    const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
    await GunDBPublic.init(null, pkey, `publicdb0`, null)
    const gooddollarProfile = '~' + GunDBPublic.user.is.pub
    logger.info('GoodDollar profile id:', {
      gooddollarProfile,
      bywalletIdx: await GunDBPublic.user.get('users/bywalletAddress').then(Gun.node.soul)
    })
    if (gooddollarProfile.indexOf('~qBFt4jGXG') === 0) {
      await GunDBPublic.user.delete()
      return
    }
    let ps = []
    GunDBPublic.user.get('users/bywalletAddress').onThen(
      data => {
        const keys = Object.keys(data || {})
        logger.info('bywalletAddress records found:', { total: keys.length })
        const updatedIndex = {}
        keys.forEach(k => {
          if (0 === k.indexOf('0x') && typeof data[k] === 'string') {
            //fix: turn public key into node ref to public profile
            updatedIndex[k] = { '#': '~' + data[k] }
          }
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to bywalletAddress`, { updatedIndex })
        ps.push(GunDBPublic.user.get('users/bywalletAddress').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
    GunDBPublic.user.get('users/bymobile').onThen(
      data => {
        const keys = Object.keys(data || {})
        logger.info('bymobile records found:', { total: keys.length })
        const updatedIndex = {}
        keys.forEach(k => {
          if (0 === k.indexOf('0x') && typeof data[k] === 'string') {
            //fix: turn public key into node ref to public profile
            updatedIndex[k] = { '#': '~' + data[k] }
          }
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to bymobile`, { updatedIndex })
        ps.push(GunDBPublic.user.get('users/bymobile').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
    GunDBPublic.user.get('users/byemail').onThen(
      data => {
        const keys = Object.keys(data || {})
        logger.info('byemail records found:', { total: keys.length })
        const updatedIndex = {}
        keys.forEach(k => {
          if (0 === k.indexOf('0x') && typeof data[k] === 'string') {
            //fix: turn public key into node ref to public profile
            updatedIndex[k] = { '#': '~' + data[k] }
          }
        })
        logger.info(`writing ${Object.keys(updatedIndex).length} records to byemail`, { updatedIndex })
        ps.push(GunDBPublic.user.get('users/byemail').putAck(updatedIndex))
      },
      { wait: 3000 }
    )
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

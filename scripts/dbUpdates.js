//@flow
import Gun from '@gooddollar/gun'
import { sha3 } from 'web3-utils'
import { delay, chunk, flattenDeep } from 'lodash'
import logger from '../src/imports/logger'
import { type UserRecord } from '../src/imports/types'
import AdminWallet from '../src/server/blockchain/AdminWallet'

import conf from '../src/server/server.config'

console.log(conf, process.env.NODE_ENV, process.env.TRAVIS)
if (process.env.NODE_ENV === 'test' || process.env.TRAVIS === 'true') process.exit(0)

const { DISPOSE_ENROLLMENTS_TASK } = require('../src/server/verification/cron/taskUtil')
const { default: UserPrivateModel } = require('../src/server/db/mongo/models/user-private')
const { DatabaseVersion, MessageStrings } = require('../src/server/db/mongo/models/props')
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
      await DelayedTaskModel.updateMany({ taskName: DISPOSE_ENROLLMENTS_TASK }, [
        {
          $set: { 'subject.enrollmentIdentifier': { $toLower: '$subject.enrollmentIdentifier' } }
        }
      ])

      dbversion.value.version = 3
      await dbversion.save()
    }

    if (version < 4) {
      await UserPrivateModel.updateMany(
        {},
        {
          $unset: { trustIndex: '' }
        }
      )

      dbversion.value.version = 4
      await dbversion.save()
    }

    if (version < 5) {
      await UserPrivateModel.updateMany(
        {},
        {
          $unset: { trustIndex: '' }
        }
      )

      dbversion.value.version = 5
      await dbversion.save()
    }

    if (version < 6) {
      await MessageStrings.create({
        value: {
          shareTitle: 'I signed up to GoodDollar. Join me.',
          shareMessage: `If you believe in economic inclusion and the distribution of prosperity for all,` +
            ` then I invite you to sign up for GoodDollar and start collecting your daily digital UBI.\n` +
            `Use my invite link and receive an extra {reward} G$ bonus:\n\n`,

          shortShareMessage: 'Hi,\nIf you believe in economic inclusion and distribution of prosperity for all,' +
            ' sign up for a GoodDollar wallet and start collecting daily digital income. ' +
            'Use my invite link and receive an extra {reward}G$\n\n'
        }
      })

      dbversion.value.version = 6
      await dbversion.save()
    }
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

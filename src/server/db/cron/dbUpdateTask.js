import Gun from '@gooddollar/gun'
import { chunk, flattenDeep } from 'lodash'
import moment from 'moment'
import { GunDBPublic } from '../../gun/gun-middleware'
import AdminWallet from '../../blockchain/AdminWallet'
import UserPrivateModel from '../../db/mongo/models/user-private'
// import { DatabaseVersion } from '../../server/db/mongo/models/props'
import getTasksRunner from '../../cron/TaskRunner'
import Logger from '../../../imports/logger'
import Config from '../../server.config'

const logger = Logger.child({ from: 'dbUpdateTask' })

export class DBUpdateTask {
  // using context allowing us to manipulate task execution
  // it's more clear that return some values.
  // also, delayed task pattern doesn't generally includes that task should return something
  // the task could pass or fail that's all. async function contract allows us to implement those statuses
  async execute({ setTime }) {
    await this.fixGunTrustProfiles2()
    setTime(
      moment()
        .add('1', 'year')
        .toDate()
    ) //run this only once so we set time to next year
  }
  G

  get schedule() {
    return Config.dbUpdateTaskCron
  }

  get name() {
    return 'DBUpdate'
  }

  /**
   * restore trust profiles
   */
  async fixGunTrustProfiles2() {
    await AdminWallet.ready
    const pkey = AdminWallet.wallets[AdminWallet.addresses[0]].privateKey.slice(2)
    await GunDBPublic.ready
    const gooddollarProfile = '~' + GunDBPublic.user.is.pub
    logger.info('fixGunTrustProfiles2 GoodDollar profile id:', {
      gooddollarProfile,
      bywalletIdx: await GunDBPublic.user.get('users/bywalletAddress').then(Gun.node.soul)
    })

    const docs = await UserPrivateModel.find(
      {
        profilePublickey: { $exists: true },
        trustIndex: { $exists: false },
        createdDate: { $lt: new Date('2020-10-08') }
      },
      'email mobile profilePublickey smsValidated isEmailConfirmed identifier'
    )
      .lean()
      .exec()

    let fixedUsers = 0
    const processChunk = users => {
      let hasWallet = 0
      const promises = users.map(async user => {
        const walletAddress = await GunDBPublic.gun
          .get('~' + user.profilePublickey)
          .get('profile')
          .get('walletAddress')
          .get('display')
          .then(null, { wait: 2000 })
        const promises = []
        if (walletAddress) {
          promises.push(UserPrivateModel.updateOne({ identifier: user.identifier }, { trustIndex: true }))
          fixedUsers += 1
          hasWallet += 1
        }

        if (user.smsValidated && user.mobile && user.mobile.startsWith('0x'))
          promises.push(GunDBPublic.addHashToIndex('mobile', user.mobile, user))
        if (user.email && user.isEmailConfirmed && user.email.startsWith('0x'))
          promises.push(GunDBPublic.addHashToIndex('email', user.email, user))
        if (walletAddress) promises.push(GunDBPublic.addUserToIndex('walletAddress', walletAddress, user))

        const indexRes = await Promise.all(promises).catch(e => {
          logger.warn('fixGunTrustProfiles2 failed user:', e, { walletAddress, user })
          return false
        })
        // logger.info('fixGunTrustProfiles2 updated user:', { walletAddress, user })
        return indexRes
      })
      return [Promise.all(promises), hasWallet]
    }

    for (let users of chunk(docs, 100)) {
      // logger.debug('fixGunTrustProfiles2 users chunk:', users)
      const [res, fixed] = await processChunk(users)
      // logger.debug('fixGunTrustProfiles2 chunk res:', { res })
      const failed = flattenDeep(res).filter(_ => _ === false)
      logger.info('fixGunTrustProfiles2 processed chunk:', { users: users.length, failed: failed.length, fixed })
    }
    logger.info('fixGunTrustProfiles2 finished:', { totalUsers: docs.length, fixedUsers })
  }
}

const dbUpdateTask = new DBUpdateTask()

getTasksRunner().registerTask(dbUpdateTask)

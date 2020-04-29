import WalletNonce from '../../db/mongo/models/wallet-nonce'
import logger from '../../../imports/logger'
import conf from '../../server.config'
import moment from 'moment'

const log = logger.child({ from: 'queueMongo' })
export default class queueMongo {
  constructor() {
    this.networkId = String(conf.ethereum.network_id)
    this.model = WalletNonce
    this.queue = []
    this.nonce = null
    this.getTransactionCount = () => 0
    this.reRunQueue = null
    this.wallets = {}
    const filter = [
      {
        $match: {
          $and: [
            { 'updateDescription.updatedFields.isLock': { $eq: false } },
            { operationType: 'update' },
            { 'fullDocument.networkId': { $eq: String(this.networkId) } }
          ]
        }
      }
    ]

    const options = { fullDocument: 'updateLookup' }

    this.model.watch(filter, options).on('change', async data => {
      await this.run()
    })
  }

  /**
   * Get new nonce after increment

   * @param {array} addresses

   * @returns {Promise<*>}
   */
  async getWalletNonce(addresses) {
    try {
      const expired = moment()
        .subtract(conf.mongoQueueMaxLockTime, 'seconds')
        .toDate()
      const filter = {
        address: { $in: addresses },
        networkId: this.networkId,
        $or: [
          { isLock: false },
          {
            lockedAt: { $lte: expired },
            isLock: true
          }
        ]
      }
      const update = { isLock: true, lockedAt: +new Date() }
      log.debug('getting free address', { addresses, expired })
      let wallet = await this.model.findOneAndUpdate(filter, update, {
        sort: { lockedAt: 1 }, //get least recently used
        returnNewDocument: true
      })
      log.debug('got free address', { addresses, expired, wallet })

      if (this.reRunQueue) {
        clearTimeout(this.reRunQueue)
      }
      this.reRunQueue = setTimeout(() => {
        this.run()
      }, conf.mongoQueueMaxLockTime * 1000)
      return wallet
    } catch (e) {
      log.error('TX queueMongo (getWalletNonce)', { addresses, errMessage: e.message, e })
      return false
    }
  }

  /**
   * Create array of addresses if not exists to db
   *
   * @param {array} addresses
   *
   * @returns {Promise<void>}
   */
  async createListIfNotExists(addresses) {
    for (let address of addresses) {
      await this.createWallet(address)
    }
  }

  /**
   * Create if not exists to db
   *
   * @param {string} address
   *
   * @returns {Promise<void>}
   */
  async createWallet(address) {
    if (this.wallets[address]) {
      return
    }
    try {
      const nonce = await this.getTransactionCount(address)
      log.debug(`init wallet ${address} with nonce ${nonce} in mongo`)
      await this.model.findOneAndUpdate(
        { address, networkId: this.networkId },
        {
          $setOnInsert: {
            address,
            nonce,
            isLock: false,
            networkId: this.networkId
          }
        },
        { upsert: true }
      )
      log.debug(`wallet initialized ${address} with nonce ${nonce} in mongo`)
      this.wallets[address] = true
    } catch (e) {
      log.error('TX queueMongo (create)', { address, errMessage: e.message, e })
    }
  }

  /**
   * Unlock for queue
   *
   * @param {string} address
   * @param {string} nextNonce
   *
   * @returns {Promise<void>}
   */
  async unlock(address, nextNonce) {
    const update = {
      isLock: false
    }
    if (nextNonce) {
      update.nonce = nextNonce
    }
    try {
      await this.model.findOneAndUpdate(
        {
          address,
          networkId: this.networkId
        },
        update,
        { returnNewDocument: true }
      )
    } catch (e) {
      log.error('errorunlock', { address, errMessage: e.message, e })
    }
  }

  /**
   * lock for queue
   *
   * @param {array}addresses
   *
   * @returns {Promise<any>}
   */
  async lock(addresses) {
    return new Promise(resolve => {
      this.addToQueue(addresses, ({ nonce, address }) => {
        resolve({
          address,
          nonce,
          release: async () => await this.unlock(address, nonce + 1),
          fail: async () => await this.unlock(address)
        })
      })
    })
  }

  /**
   *  Add new tr to
   *
   * @param {array} addresses
   * @param {function} cb
   *
   * @returns {Promise<void>}
   */
  async addToQueue(addresses, cb) {
    addresses = Array.isArray(addresses) ? addresses : [addresses]
    await this.createListIfNotExists(addresses)

    this.queue.push({ cb, addresses })

    this.run()
  }

  /**
   * Run the first transaction from the queue
   *
   * @returns {Promise<void>}
   */
  async run() {
    let nextTr, walletNonce
    try {
      if (this.queue.length > 0) {
        nextTr = this.queue.shift()
        walletNonce = await this.getWalletNonce(nextTr.addresses)
        if (walletNonce) {
          nextTr.cb({ nonce: walletNonce.nonce, address: walletNonce.address })
        } else {
          this.queue.push(nextTr)
        }
      }
    } catch (e) {
      log.error('TX queueMongo (run)', { nextTr, walletNonce, errMessage: e.message, e })
    }
  }

  /**
   * Get lock status for address
   *
   * @param {string} address
   *
   * @returns {Boolean}
   */
  async isLocked(address) {
    const wallet = await this.model.findOne({ address, networkId: this.networkId })
    const expired = moment().subtract(conf.mongoQueueMaxLockTime, 'seconds')
    const lockNotExpired = wallet && wallet.lockedAt && expired.isBefore(wallet.lockedAt)
    return Boolean(wallet && (wallet.isLock && lockNotExpired))
  }
}

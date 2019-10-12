import WalletNonce from '../../db/mongo/models/wallet-nonce'
import logger from '../../../imports/pino-logger'
import conf from '../../server.config'
import fs from 'fs'

export const fileLog = (...props) => {
  fs.appendFileSync('log.txt', `${JSON.stringify(props)}\n`)
}

const log = logger.child({ from: 'queueMongo' })
const MAX_LOCK_TIME = 30 // seconds
export default class queueMongo {
  constructor() {
    this.networkId = String(conf.ethereum.network_id)
    this.model = WalletNonce
    this.queue = []
    this.nonce = null
    this.getTransactionCount = () => 0
    this.reRunQueue = null
    const filter = [
      {
        $match: {
          $and: [
            // { 'updateDescription.updatedFields.isLock': { $eq: false } },
            { operationType: 'update' },
            { 'fullDocument.networkId': { $eq: String(this.networkId) } }
          ]
        }
      }
    ]

    const options = { fullDocument: 'updateLookup' }

    // listen to the collection
    this.model.watch(filter, options).on('change', async data => {
      fileLog(
        'mongo change',
        data.fullDocument.address,
        data.updateDescription.updatedFields.nonce,
        data.updateDescription.updatedFields.isLock
      )
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
      const filter = {
        address: { $in: addresses },
        networkId: this.networkId,
        $or: [
          { isLock: false },
          {
            lockedAt: { $lte: +new Date() - MAX_LOCK_TIME * 1000 },
            isLock: true
          }
        ]
      }
      const update = { isLock: true, lockedAt: +new Date(), networkId: this.networkId }
      // fileLog('Get wallet nonce',{ filter, update })
      let wallet = await this.model.findOneAndUpdate(filter, update, { returnNewDocument: true }).sort({ lockedAt: -1 })
      fileLog('getWalletNonce', wallet && wallet.address)
      if (this.reRunQueue) {
        clearTimeout(this.reRunQueue)
      }
      this.reRunQueue = setTimeout(() => {
        this.run()
      }, MAX_LOCK_TIME * 1000)
      return wallet
    } catch (e) {
      logger.error('TX queueMongo (getWalletNonce)', e)
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
    const exists = await this.model.find({ address: { $in: addresses } }).lean()
    for (let address of addresses) {
      if (!~exists.findIndex(e => e.address === address)) {
        await this.createWallet(address)
      }
    }
  }

  /**
   * Create if not exists to db
   *
   * @param {string} address
   *
   * @returns {Promise<void>}
   */
  async createIfNotExist(address) {
    try {
      // log.debug(`create if not exists wallet ${address}`)
      let wallet = await this.model.findOne({ address })
      if (!wallet) {
        await this.createWallet(wallet)
      }
    } catch (e) {
      logger.error('TX queueMongo (createIfNotExist)', e)
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
    fileLog('createWallet', address)
    try {
      const nonce = await this.getTransactionCount(address)
      log.debug(`init wallet ${address} with nonce ${nonce} in mongo`)
      await this.model.create({
        address,
        nonce,
        networkId: this.networkId
      })
    } catch (e) {
      logger.error('TX queueMongo (create)', e)
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
  async errorUnlock(address) {
    fileLog('errorunlock', address)
    try {
      await this.model.findOneAndUpdate(
        {
          address,
          isLock: true,
          networkId: this.networkId
        },
        {
          isLock: false
        },
        { returnNewDocument: true }
      )
    } catch (e) {
      fileLog('errorunlock', address, e)
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
    fileLog('unlock', address, nextNonce)
    try {
      await this.model.findOneAndUpdate(
        {
          address,
          networkId: this.networkId
        },
        {
          isLock: false,
          nonce: nextNonce
        },
        { returnNewDocument: true }
      )
    } catch (e) {
      logger.error('unlock error', e)
    }
  }

  /**
   * lock for queue
   *
   * @param {array}addresses
   * @param {function}getTransactionCount
   *
   * @returns {Promise<any>}
   */
  async lock(addresses) {
    return new Promise(resolve => {
      this.addToQueue(addresses, ({ nonce, address }) => {
        fileLog(`lock ${address} nonce ${nonce + 1}`)
        resolve({
          address,
          nonce,
          release: async () => {
            // fileLog(`unlock ${address} nonce ${nonce + 1}`)
            return await this.unlock(address, nonce + 1)
          },
          fail: async () => {
            // fileLog(`fail ${address} nonce ${nonce} --`)
            return await this.errorUnlock(address)
          }
        })
      })
    })
  }

  /**
   *  Add new tr to
   *
   * @param {array} addresses
   * @param {string} netNonce
   * @param {function} cb
   *
   * @returns {Promise<void>}
   */
  async addToQueue(addresses, cb) {
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
    try {
      if (this.queue.length > 0) {
        const nextTr = this.queue[0]

        const walletNonce = await this.getWalletNonce(nextTr.addresses)
        if (walletNonce) {
          this.queue.shift()
          nextTr.cb({ nonce: walletNonce.nonce, address: walletNonce.address })
        }
      }
    } catch (e) {
      log.error('TX queueMongo (run)', e)
    }
  }
}

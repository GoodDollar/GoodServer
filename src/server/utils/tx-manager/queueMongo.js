import WalletNonce from '../../db/mongo/models/wallet-nonce'
import logger from '../../../imports/pino-logger'

const log = logger.child({ from: 'queueMongo' })
const MAX_LOCK_TIME = 30 // seconds
export default class queueMongo {
  constructor() {
    this.model = WalletNonce
    this.queue = []
    this.nonce = null
    this.reRunQueue = null
    const filter = [
      {
        $match: {
          $and: [{ 'updateDescription.updatedFields.isLock': { $eq: false } }, { operationType: 'update' }]
        }
      }
    ]

    const options = { fullDocument: 'updateLookup' }

    // listen to the collection
    this.model.watch(filter, options).on('change', async data => {
      await this.run()
    })
  }

  /**
   * Get new nonce after increment

   * @param {string} address

   * @returns {Promise<*>}
   */
  async getWalletNonce(address) {
    try {
      let wallet = await this.model.findOneAndUpdate(
        {
          address,
          $or: [
            { isLock: false },
            {
              lockedAt: { $lte: +new Date() - MAX_LOCK_TIME * 1000 },
              isLock: true
            }
          ]
        },
        { isLock: true, lockedAt: +new Date() },
        { returnNewDocument: true }
      )
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
   * Create if not exist nonce to db
   *
   * @param {string} address
   * @param {string} netNonce
   *
   * @returns {Promise<void>}
   */
  async createIfNotExist(address, netNonce) {
    try {
      let wallet = await this.model.findOne({ address })

      if (!wallet) {
        await this.model.create({
          address,
          nonce: netNonce
        })
      }
    } catch (e) {
      logger.error('TX queueMongo (createIfNotExist)', e)
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
    await this.model.findOneAndUpdate(
      { address },
      {
        isLock: false
      },
      { returnNewDocument: true }
    )
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
    try {
      await this.model.findOneAndUpdate(
        { address },
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
   * @param {string}address
   * @param {string}netNonce
   *
   * @returns {Promise<any>}
   */
  async lock(address, netNonce) {
    return new Promise(resolve => {
      this.addToQueue(address, netNonce, nonce =>
        resolve({
          nonce,
          release: async () => await this.unlock(address, nonce + 1),
          fail: async () => await this.errorUnlock(address)
        })
      )
    })
  }

  /**
   *  Add new tr to
   *
   * @param {string} address
   * @param {string} netNonce
   * @param {function} cb
   *
   * @returns {Promise<void>}
   */
  async addToQueue(address, netNonce, cb) {
    await this.createIfNotExist(address, netNonce)

    this.queue.push({ cb, address })

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

        const walletNonce = await this.getWalletNonce(nextTr.address)
        if (walletNonce) {
          this.queue.shift()
          nextTr.cb(walletNonce.nonce)
        }
      }
    } catch (e) {
      log.error('TX queueMongo (run)', e)
    }
  }
}

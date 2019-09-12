import WalletNonce from '../../db/mongo/models/wallet-nonce'
import logger from '../../../imports/pino-logger'

const log = logger.child({ from: 'queueMongo' })

export default class queueMongo {
  constructor() {
    this.model = WalletNonce
    this.queue = []
    this.nonce = null

    const filter = [
      {
        $match: {
          $and: [{ 'updateDescription.updatedFields.isLock': { $eq: false } }, { operationType: 'update' }]
        }
      }
    ]

    const options = { fullDocument: 'updateLookup' }

    // listen to the collection
    this.model.watch(filter, options).on('change', data => {
      this.run()
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
        { address, isLock: false },
        { isLock: true },
        { returnNewDocument: true }
      )

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
  async unlock(address, nextNonce) {
    const res = await this.model.findOneAndUpdate(
      { address },
      {
        isLock: false,
        nonce: nextNonce
      },
      { returnNewDocument: true }
    )
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
          fail: async () => await this.unlock(address, nonce)
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

  /**
   * Get lock status for address
   *
   * @param {string} address
   *
   * @returns {Boolean}
   */
  async isLocked(address) {
    const wallet = await this.model.findOne({ address })

    return Boolean(wallet && wallet.isLock)
  }
}

import WalletNonce from '../../db/mongo/models/wallet-nonce'
import logger from '../../../imports/logger'
import conf from '../../server.config'
import moment from 'moment'
import { remove } from 'lodash'

export default class queueMongo {
  constructor(networkId, lockExpireSeconds = conf.mongoQueueMaxLockTime) {
    this.log = logger.child({ from: 'queueMongo-' + networkId })
    this.lockExpireSeconds = lockExpireSeconds
    this.networkId = networkId
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

    this.model.watch(filter, options).on('change', async () => {
      await this.run()
    })

    this.log.info('queueMongo created')
  }

  /**
   * Get new nonce after increment

   * @param {array} addresses

   * @returns {Promise<*>}
   */
  async getWalletNonce(addresses, id) {
    try {
      const expired = moment()
        .subtract(this.lockExpireSeconds, 'seconds')
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
      this.log.debug('getting free address', { addresses, expired, id })
      let wallet = await this.model.findOneAndUpdate(filter, update, {
        sort: { lockedAt: 1 }, //get least recently used
        returnNewDocument: true
      })
      this.log.debug('got free address', { addresses, expired, wallet, id })

      return wallet
    } catch (e) {
      this.log.error('TX queueMongo (getWalletNonce)', e.message, e, { addresses, id })
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
    const ps = addresses.map(_ => this.createWallet(_))
    await Promise.all(ps)
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
      this.log.debug(`init wallet ${address} with nonce ${nonce} in mongo`)
      await this.model.findOneAndUpdate(
        { address, networkId: this.networkId },
        {
          $setOnInsert: {
            address,
            isLock: false,
            networkId: this.networkId
          },
          //make sure we reset nonce on startup
          $set: {
            nonce
          }
        },
        { upsert: true }
      )
      this.log.debug(`wallet initialized ${address} with nonce ${nonce} in mongo`)
      this.wallets[address] = true
    } catch (e) {
      this.log.error('TX queueMongo (create)', e.message, e, { address })
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
    if (nextNonce != null) {
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
      this.log.error('errorunlock', e.message, e, { address })
    }
  }

  /**
   * lock for queue
   *
   * @param {array}addresses
   *
   * @returns {Promise<any>}
   */
  lock(addresses, timeout = 15000, id) {
    return new Promise((resolve, reject) => {
      let timer
      let released = false

      //this callback is called by the queue to resolve the promise
      const cb = ({ nonce, address }) => {
        timer && clearTimeout(timer)
        resolve({
          address,
          nonce,
          release: async () => {
            released = true
            await this.unlock(address, nonce + 1)
          },
          fail: async () => !released && (await this.unlock(address))
        })
      }

      timer = setTimeout(() => {
        //if timer make sure to remove request from queue
        this.removeFromQueue(cb, id)
        reject(new Error('lock not acquired timeout id:' + id))
        this.log.warn('lock timedout,', { addresses, id })
      }, timeout)

      this.addToQueue(addresses, cb, id)
    })
  }

  async lockOrFail(addresses, id) {
    addresses = Array.isArray(addresses) ? addresses : [addresses]
    await this.createListIfNotExists(addresses)
    const wallet = await this.getWalletNonce(addresses, id)
    if (wallet) {
      return {
        ...wallet,
        release: async () => await this.unlock(wallet.address, wallet.nonce + 1),
        fail: async () => await this.unlock(wallet.address)
      }
    } else {
      throw new Error('lock not acquired')
    }
  }

  removeFromQueue(cb, id) {
    this.log.info('removeFromQueue', { cb, id, queue: this.queue.length })
    remove(this.queue, x => {
      if (x.cb === cb || x.id === id) {
        this.log.info('removed from queue', { x, id })
        return (x.removed = true)
      }
      return false
    })
    this.log.info('removeFromQueue result ', { cb, id, queue: this.queue.length })
  }

  /**
   *  Add new tr to
   *
   * @param {array} addresses
   * @param {function} cb
   *
   * @returns {Promise<void>}
   */
  async addToQueue(addresses, cb, id) {
    addresses = Array.isArray(addresses) ? addresses : [addresses]
    await this.createListIfNotExists(addresses)

    this.queue.push({ cb, addresses, id })

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
        if (!nextTr.removed) walletNonce = await this.getWalletNonce(nextTr.addresses, nextTr.id)
        if (walletNonce) {
          nextTr.cb({ nonce: walletNonce.nonce, address: walletNonce.address })
        } else {
          !nextTr.removed && this.queue.push(nextTr)
        }

        //make sure we will run again, even though there's a mongodb listener
        if (this.reRunQueue) {
          clearTimeout(this.reRunQueue)
        }
        this.reRunQueue = setTimeout(() => {
          this.run()
        }, this.lockExpireSeconds * 1000)
      }
    } catch (e) {
      this.log.error('TX queueMongo (run)', e.message, e, { nextTr, walletNonce })
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
    const expired = moment().subtract(this.lockExpireSeconds, 'seconds')
    const lockNotExpired = wallet && wallet.lockedAt && expired.isBefore(wallet.lockedAt)
    return Boolean(wallet && wallet.isLock && lockNotExpired)
  }
}

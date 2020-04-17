import Mutex from 'await-mutex'
import logger from '../../../imports/logger'
const log = logger.child({ from: 'wallet queueMutex' })

export default class queueMutex {
  constructor() {
    this.wallets = {}
    this.getTransactionCount = () => 0
  }

  /**
   * Create object of wallets by addresses
   *
   * @param {array} addresses
   *
   * @returns {Promise<void>}
   */
  async createListIfNotExists(addresses) {
    for (let address of addresses) {
      if (!this.getWallet(address)) {
        const data = await this.createWallet(address)
        log.info('created mutex for address:', { address, nonce: data.nonce })
      }
    }
  }

  /**
   * Create object of wallet by address
   * @param address
   */
  async createWallet(address) {
    return (this.wallets[address] = {
      address,
      nonce: await this.getTransactionCount(address),
      mutex: new Mutex()
    })
  }

  /**
   * Get wallet by address
   * @param address
   * @returns {T}
   */
  getWallet(address) {
    return this.wallets[address]
  }

  /**
   * Unlock for queue
   *
   * @param {string} address
   * @param {string} netNonce
   *
   * @returns {Promise<void>}
   */
  async unlock(address, netNonce) {
    const wallet = this.getWallet(address)

    if (wallet && typeof wallet.lastFail === 'function') {
      wallet.lastFail(netNonce)
    }
  }

  /**
   * lock for queue
   *
   * @param {array} addresses
   *
   * @returns {Promise<any>}
   */
  async lock(addresses) {
    addresses = Array.isArray(addresses) ? addresses : [addresses]
    // await this.createListIfNotExists(addresses)
    log.debug('lock request', { addresses })
    const address = await this.getFirstFreeAddress(addresses)
    let wallet = this.getWallet(address)
    if (wallet === undefined) {
      wallet = await this.createWallet(address)
    }
    log.debug('lock: got wallet', { address, wallet })
    let release = await wallet.mutex.lock()
    log.debug('lock: acquired lock', { address })
    wallet.release = () => {
      wallet.nonce++
      release()
    }
    wallet.lastFail = netNonce => {
      if (netNonce) {
        wallet.nonce = netNonce
      }
      release()
    }

    return {
      address,
      nonce: wallet.nonce,
      release: wallet.release,
      fail: wallet.lastFail
    }
  }

  /**
   * Get lock status for address
   *
   * @param {string} address
   *
   * @returns {Boolean}
   */
  isLocked(address) {
    const wallet = this.getWallet(address)
    if (wallet) {
      const res = wallet.mutex.isLocked()
      return res
    }
    return false
  }

  async getFirstFreeAddress(addresses) {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        //use random to simulate real conditions, otherwise same address will be taken on single host
        const address = addresses[Math.floor(Math.random() * addresses.length)]
        // for (let address of addresses) {
        if (this.isLocked(address) === false) {
          log.debug('getFirstFreeAddress: address not locked', { address })

          clearInterval(interval)
          return resolve(address)
        }
        log.debug('getFirstFreeAddress: address locked', { address })
        // }
      }, 100)
    })
  }
}

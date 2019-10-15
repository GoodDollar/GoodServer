import Mutex from 'await-mutex'

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
        await this.createWallet(address)
      }
    }
  }

  /**
   * Create object of wallet by address
   * @param address
   */
  async createWallet(address) {
    this.wallets[address] = {
      address,
      nonce: await this.getTransactionCount(address),
      mutex: new Mutex()
    }
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
    const address = (addresses && Array.isArray(addresses) && addresses[0]) || addresses
    let wallet = this.getWallet(address)

    if (!wallet) {
      await this.createWallet(address)
      wallet = this.getWallet(address)
    }
    let release = await wallet.mutex.lock()
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
  async isLocked(address) {
    const wallet = this.getWallet(address)
    if (wallet) {
      return wallet.mutex.isLocked()
    }
    return false
  }
}

import Mutex from 'await-mutex'

export default class queueMutex {
  constructor() {
    this.nonce = null
    this.mutex = new Mutex()
    this.lastFail = null
  }

  /**
   * Unlock for queue
   *
   * @param {string} address
   * @param {string} nextNonce
   *
   * @returns {Promise<void>}
   */
  async errorUnlock(address, nonce) {
    if (typeof this.lastFail === 'function') {
      this.lastFail()
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
  async unlock(address, nonce) {
    if (typeof this.lastFail === 'function') {
      this.lastFail()
    }
  }

  /**
   * lock for queue
   *
   * @param {string} address
   * @param {string} netNonce
   *
   * @returns {Promise<any>}
   */
  async lock(address, netNonce) {
    if (!this.nonce) {
      this.nonce = netNonce
    } else {
      this.nonce++
    }

    let release = await this.mutex.lock()
    this.lastFail = () => {
      this.nonce--
      release()
    }
    return {
      nonce: this.nonce,
      release: release,
      fail: this.lastFail
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
  async createIfNotExist(address, netNonce) {}
}

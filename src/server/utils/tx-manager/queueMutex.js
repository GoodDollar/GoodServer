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
  async unlock(address, nextNonce) {
    if (typeof this.lastFail === 'function') {
      this.lastFail()
      if (nextNonce) {
        this.nonce = nextNonce
      }
    }
  }
  /**
   * lock for queue
   *
   * @param {string} address
   * @param {function} getTransactionCount
   *
   * @returns {Promise<any>}
   */
  async lock(address, getTransactionCount) {
    if (!this.nonce) {
      this.nonce = await getTransactionCount(address)
    }
    this.nonce++
    console.log('+++++++ SET NONCE +++++', this.nonce)
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
}

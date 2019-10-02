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
      this.lastFail(nonce)
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

    let release = await this.mutex.lock()

    this.lastFail = nextNonce => {
      if (nextNonce) {
        this.nonce = nextNonce
        console.log('+++++++ CHANGE nextNonce  +++++', this.nonce)
      } else {
        console.log('+++++++ CHANGE FAIL NONCE  +++++', this.nonce)
      }
      release()
    }

    this.lastRelease = () => {
      this.nonce++
      console.log('+++++++ SET lastRelease NONCE +++++', this.nonce)
      release()
    }
    return {
      nonce: this.nonce,
      release: this.lastRelease,
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

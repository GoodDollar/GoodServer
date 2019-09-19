import Mutex from 'await-mutex'

export default class queueMutex {
  constructor() {
    this.nonce = null
    this.mutex = new Mutex()
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
    } else {
      this.nonce++
    }

    let release = await this.mutex.lock()

    return {
      nonce: this.nonce,
      release: release,
      fail: () => {
        this.nonce--
        release()
      }
    }
  }
}

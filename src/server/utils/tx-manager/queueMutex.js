import Mutex from 'await-mutex'

export default class queueMutex {
  constructor() {
    this.queue = []
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
    return this.unlock()
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
    const obj = this.queue.find(i => i.address === address) || {}

    if (typeof obj.lastFail === 'function') {
      obj.lastFail()
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
    const index = this.queue.findIndex(i => i.address === address)
    let obj

    if (~index) {
      obj = this.queue[index]

      obj.nonce++
    } else {
      this.queue.push({
        address,
        nonce: netNonce,
        mutex: new Mutex()
      })

      obj = this.queue[this.queue.length - 1]
    }

    let release = await obj.mutex.lock()

    obj.lastFail = () => {
      release()
    }

    return {
      nonce: obj.nonce,
      release,
      fail: obj.lastFail
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
    const index = this.queue.findIndex(i => i.address === address)
    let result = false

    if (~index) {
      const obj = this.queue[index]
      const mutex = obj.mutex

      result = mutex.isLocked()
    }

    return result
  }
}

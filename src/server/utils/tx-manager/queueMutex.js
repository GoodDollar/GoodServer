import Mutex from 'await-mutex'

export default class queueMutex {
  constructor() {
    this.queue = []
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
    } else {
      this.queue.push({
        address,
        nonce: netNonce,
        mutex: new Mutex()
      })

      obj = this.queue[this.queue.length - 1]
    }

    let release = await obj.mutex.lock()

    return {
      nonce: obj.nonce,
      release: () => {
        obj.nonce++
        release()
      },
      fail: () => {
        release()
      }
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

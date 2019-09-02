import axios from 'axios'
import config from '../server.config'
class FuseApi {
  constructor() {
    this.mainUrl = config.fuse
  }

  /**
     * Get transaction list
     * @param {
        address,
        page,
        offset,
        filterby,
        startBlock,
        endBlock,
        starttimestamp,
        endtimestamp,
        sort
     * } options
     */
  async getTxList(options) {
    const r = await this.runMethod('account', 'txlist', options)
    console.log('getTxList', r.result.length)
    return this.runMethod('account', 'txlist', options)
  }

  async runMethod(module, action, options) {
    const result = await axios.get(`${this.mainUrl}/api`, {
      params: {
        module,
        action,
        ...options
      }
    })
    return result && result.data
  }
}

export default new FuseApi()

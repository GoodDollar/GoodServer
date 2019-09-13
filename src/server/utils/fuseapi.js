import fetch from 'cross-fetch'
import qs from 'qs'
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
    return this.runMethod('account', 'txlist', options)
  }

  async runMethod(module, action, options) {
    const queryParams = qs.stringify({
      module,
      action,
      ...options
    })
    const res = await fetch(`${this.mainUrl}/api?${queryParams}`)
    if (res.status >= 400) {
      throw new Error('Bad response from server')
    }
    return await res.json()
  }
}

export default new FuseApi()

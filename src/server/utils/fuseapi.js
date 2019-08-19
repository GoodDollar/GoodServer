import request from 'request'
import qs from 'qs'
class FuseApi {
  constructor() {
    this.mainUrl = 'https://explorer.fuse.io'
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
  getTxList(options) {
    return this.runMethod('account', 'txlist', options)
  }

  runMethod(module, action, options) {
    return new Promise((resolve, reject) => {
      const queryParams = qs.stringify({
        module,
        action,
        ...options
      })
      request(`${this.mainUrl}/api?${queryParams}`, { json: true }, (err, res, body) => {
        if (err) {
          return reject(err)
        }
        return resolve(body)
      })
    })
  }
}

export default new FuseApi()

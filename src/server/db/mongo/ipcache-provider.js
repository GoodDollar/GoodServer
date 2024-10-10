import ipCacheModel from './models/ipaccounts-cache'
import logger from '../../../imports/logger'

class IpAccountsCache {
  constructor(model, logger) {
    this.logger = logger

    this.model = model
  }

  async updateAndGet(ip, address) {
    try {
      return this.model
        .findOneAndUpdate({ ip }, { $addToSet: { accounts: [address] } }, { upsert: true, returnOriginal: false })
        .lean()
    } catch (ex) {
      logger.error('Update ip accounts in ipcache failed:', ex.message, ex, { ip, address })
      throw ex
    }
  }
}
export default new IpAccountsCache(ipCacheModel, logger.child({ from: 'IpAccountsCache' }))

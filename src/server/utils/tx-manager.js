import config from '../server.config'
import queueMongo from './tx-manager/queueMongo'
import queueMutex from './tx-manager/queueMutex'

class TransactionRun {
  /**
   * Return manager instance
   *
   * @returns {*}
   */
  static getManagerInstance() {
    let queueManager = null

    if (config.enableMongoLock) {
      queueManager = new queueMongo()
    } else {
      queueManager = new queueMutex()
    }

    return queueManager
  }
}

export default TransactionRun.getManagerInstance()

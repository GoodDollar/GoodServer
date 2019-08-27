import config from '../server.config'
import queueMongo from './tx-manager/queueMongo'
import queueMutex from './tx-manager/queueMutex'

const network_id = config.ethereum.network_id
const LOCAL_NETWORK_ID = 4447

class TransactionRun {
  /**
   * Return manager instance
   *
   * @returns {*}
   */
  static getManagerInstance() {
    let queueManager = null

    switch (network_id) {
      case LOCAL_NETWORK_ID:
        queueManager = new queueMutex()
        break

      default:
        queueManager = new queueMongo()
        break
    }

    return queueManager
  }
}

export default TransactionRun.getManagerInstance()

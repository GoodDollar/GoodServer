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

    queueManager = getManager(config.ethereum.network_id)
    return queueManager
  }
}

const getManager = networkId => {
  let queueManager = null
  if (config.enableMongoLock) {
    queueManager = new queueMongo(networkId)
  } else {
    queueManager = new queueMutex()
  }
  return queueManager
}

export { getManager }
export default TransactionRun.getManagerInstance()

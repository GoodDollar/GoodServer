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

const managers = {}
const getManager = networkId => {
  if (managers[networkId] === undefined) {
    if (config.enableMongoLock) {
      managers[networkId] = new queueMongo(networkId)
    } else {
      managers[networkId] = new queueMutex()
    }
  }
  return managers[networkId]
}

export { getManager }
export default TransactionRun.getManagerInstance()

// @flow

import logger from '../../../imports/logger'
import Config from '../../server.config'

class CleanupAbandonedSignups {
  schedule = null
  model = null
  logger = null

  get name() {
    return 'storage/cleanup_abandoned_signups'
  }

  constructor(Config, storage, logger) {
    const { storageCleanupCron } = Config

    this.logger = logger
    this.schedule = storageCleanupCron
    this.model = storage.model
  }

  async execute() {
    const { model, logger } = this

    try {
      // TODO: need to check
      await model
        .find({
          torusProvider: { $not: { $type: 'string', $ne: '' } }
        })
        .remove()
        .exec()
    } catch (e) {
      logger.error('Error cleaning abandoned signups up', e.message, e)
    }
  }
}

export default storage =>
  new CleanupAbandonedSignups(Config, storage, logger.child({ from: 'CleanupAbandonedSignups' }))

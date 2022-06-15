// @flow

import logger from '../../../imports/logger'
import Config from '../../server.config'

class CleanupAbandonedSignups {
  static get mandatoryFields() {
    return ['createdDate', 'lastLogin', 'isCompleted']
  }

  static nonExists(field) {
    return { [field]: { $exists: false } }
  }

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
    const { nonExists, mandatoryFields } = CleanupAbandonedSignups
    const missingFields = mandatoryFields.map(nonExists)

    try {
      await model
        .find({ $or: missingFields })
        .remove()
        .exec()
    } catch (e) {
      logger.error('Error cleaning abandoned signups up', e.message, e)
    }
  }
}

export default storage =>
  new CleanupAbandonedSignups(Config, storage, logger.child({ from: 'CleanupAbandonedSignups' }))

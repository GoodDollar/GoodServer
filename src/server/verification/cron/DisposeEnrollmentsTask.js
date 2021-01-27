// @flow

import { bindAll } from 'lodash'

import logger from '../../../imports/logger'
import Config from '../../server.config'

import createEnrollmentProcessor from '../processor/EnrollmentProcessor'
import { DISPOSE_ENROLLMENTS_TASK } from './TaskService'

class DisposeEnrollmentsTask {
  schedule = null
  processor = null
  logger = null

  get name() {
    return DISPOSE_ENROLLMENTS_TASK
  }

  constructor(Config, enrollmentProcessor, logger) {
    const { faceVerificationCron } = Config

    this.logger = logger
    this.schedule = faceVerificationCron
    this.processor = enrollmentProcessor

    bindAll(this, 'onEnrollmentProcesed')
  }

  async execute() {
    const { onEnrollmentProcesed, processor, logger } = this

    await processor.disposeEnqueuedEnrollments(onEnrollmentProcesed, logger)
  }

  onEnrollmentProcesed(identifier: string, exception?: Error) {
    const { logger } = this

    if (exception) {
      const { message: errMessage } = exception

      logger.error(`Couldn't dispose enrollment for ID '${identifier}'`, errMessage, exception, { identifier })
      return
    }

    logger.info(`Successfully disposed enrollment for ID '${identifier}'`)
  }
}

export default storage =>
  new DisposeEnrollmentsTask(
    Config,
    createEnrollmentProcessor(storage),
    logger.child({ from: 'DisposeEnrollmentsTask' })
  )

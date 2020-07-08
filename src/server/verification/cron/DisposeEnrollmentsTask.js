// @flow

import { bindAll } from 'lodash'

import logger from '../../../imports/logger'
import createEnrollmentProcessor, { DISPOSE_ENROLLMENTS_TASK } from '../processor/EnrollmentProcessor'

class DisposeEnrollmentsTask {
  processor = null
  logger = null

  get schedule() {
    return '0 0 * * * *' //once an hour
  }

  get name() {
    return DISPOSE_ENROLLMENTS_TASK
  }

  constructor(enrollmentProcessor, logger) {
    this.logger = logger
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
      const logPayload = { e: exception, errMessage, identifier }

      logger.error(`Couldn't dispose enrollment for ID '${identifier}'`, logPayload)
      return
    }

    logger.info(`Successfully disposed enrollment for ID '${identifier}'`)
  }
}

export default storage =>
  new DisposeEnrollmentsTask(createEnrollmentProcessor(storage), logger.child({ from: 'DisposeEnrollmentsTask' }))

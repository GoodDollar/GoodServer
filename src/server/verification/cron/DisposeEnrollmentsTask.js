// @flow

import createEnrollmentProcessor, { DISPOSE_ENROLLMENTS_TASK } from '../processor/EnrollmentProcessor'

class DisposeEnrollmentsTask {
  processor = null

  get schedule() {
    return '0 * * * *'
  }

  get name() {
    return DISPOSE_ENROLLMENTS_TASK
  }

  // TODO: inject logger
  constructor(enrollmentProcessor) {
    this.processor = enrollmentProcessor
  }

  async execute() {
    await this.processor.disposeEnqueuedEnrollments((identifier: string, exception?: Error) => {
      //TODO: log success / error
    })
  }
}

export default storage => new DisposeEnrollmentsTask(createEnrollmentProcessor(storage))

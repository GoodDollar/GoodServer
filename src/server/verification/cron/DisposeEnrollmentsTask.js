// @flow

import createEnrollmentProcessor from '../processor/EnrollmentProcessor'

class DisposeEnrollmentsTask {
  processor = null

  get schedule() {
    return '0 * * * *'
  }

  get name() {
    return 'verification/dispose_enrollments'
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

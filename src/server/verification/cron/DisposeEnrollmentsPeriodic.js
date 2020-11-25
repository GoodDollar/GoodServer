import moment from 'moment'
import AdminWallet from '../../blockchain/AdminWallet'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import getTasksRunner from '../../cron/TaskRunner'
import Logger from '../../../imports/logger'
import Config from '../../server.config'

import createEnrollmentProcessor from '../processor/EnrollmentProcessor'

const logger = Logger.child({ from: 'disposeEnrollmentsPeriodic' })

export class DisposeEnrollmentsPeriodicTask {
  get schedule() {
    return Config.enrollDisposalCron
  }

  get name() {
    return 'DisposeEnrollmentPeriodic'
  }

  async execute({ setTime }) {
    try {
      logger.info('Starting worker', this.name)
      const authenticationPeriod = await this.getAuthenticationPeriod()
      logger.info('Authentication period found', authenticationPeriod)
      const fvRecords = await this.getFVRecords(authenticationPeriod)
      logger.info(`Fetched ${fvRecords.length} FV records from db`)
      const disposeEnrollments = await this.disposeEnrollments(fvRecords)
      logger.info(`Performed Dispose Enrollment for ${disposeEnrollments.length} enrollmentIds`)
      const enrollmentIdentifiers = disposeEnrollments.reduce((arr, disposeEnrollment) => {
        if (disposeEnrollment.status !== 'failed') arr.push(disposeEnrollment.enrollmentIdentifier)
        return arr
      }, [])
      logger.info(`Removing ${enrollmentIdentifiers.length} disposed FV Records from DB`)
      const result = await this.removeRecords(enrollmentIdentifiers)
      return result
    } catch (error) {
      logger.error(`Failed running worker ${this.name}`, error)
    }
  }

  async getAuthenticationPeriod() {
    const authenticationPeriod = await AdminWallet.getAuthenticationPeriod()
    return authenticationPeriod
  }

  async getFVRecords(authenticationPeriod) {
    const lastValidAuthenticationPeriod = moment()
      .subtract(parseInt(authenticationPeriod), 'days')
      .toDate()

    const fvRecords = await UserDBPrivate.getFaceVerificationsBeforeDate(lastValidAuthenticationPeriod)
    return fvRecords
  }

  /**
   * restore trust profiles
   */
  async disposeEnrollments(fvRecords) {
    const enrollmentIds = fvRecords.map(fvRecord => {
      return fvRecord.enrollmentIdentifier
    })

    logger.info('Enrollment Ids to dispose:', enrollmentIds)
    const enrollmentProcessor = createEnrollmentProcessor(UserDBPrivate, logger)
    const disposedEnrollments = await enrollmentProcessor.disposeEnrollments(enrollmentIds)
    logger.debug('disposed enrollments result', disposedEnrollments)
    return disposedEnrollments
  }

  async removeRecords(enrollmentIdentifiers) {
    const result = await UserDBPrivate.deleteFaceVerificationsByEnrollmentIdentifiers(enrollmentIdentifiers)
    return result
  }
}

const disposeEnrollmentsPeriodicTask = new DisposeEnrollmentsPeriodicTask()

getTasksRunner().registerTask(disposeEnrollmentsPeriodicTask)

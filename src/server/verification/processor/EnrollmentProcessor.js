// @flow
import { chunk, noop } from 'lodash'
import moment from 'moment'

import Config from '../../server.config'
import AdminWallet from '../../blockchain/AdminWallet'
import logger from '../../../imports/logger'

import { type IEnrollmentProvider } from './typings'
import { type DelayedTaskRecord } from '../../../imports/types'

import EnrollmentSession from './EnrollmentSession'

import getZoomProvider from './provider/ZoomProvider'
import { DisposeAt, scheduleDisposalTask, DISPOSE_ENROLLMENTS_TASK, forEnrollment } from '../cron/taskUtil'

// count of chunks pending tasks should (approximately) be split to
const DISPOSE_BATCH_AMOUNT = 10
// minimal & maximal chunk sizes
const DISPOSE_BATCH_MINIMAL = 10
const DISPOSE_BATCH_MAXIMAL = 50

class EnrollmentProcessor {
  logger = null
  storage = null
  adminApi = null
  keepEnrollments = null

  _provider = null

  get provider() {
    const { _provider } = this

    if (!_provider) {
      throw new Error(`Provider haven't registered.`)
    }

    return _provider
  }

  constructor(config, storage, adminApi, logger) {
    const { keepFaceVerificationRecords } = config

    this.logger = logger
    this.storage = storage
    this.adminApi = adminApi
    this.keepEnrollments = keepFaceVerificationRecords
  }

  registerProvier(provider: IEnrollmentProvider): void {
    this._provider = provider
  }

  async validate(user: any, enrollmentIdentifier: string, payload: any): Promise<void> {
    const { sessionId } = payload || {}
    const { provider } = this

    if (!user || !enrollmentIdentifier || !payload || !sessionId || !provider.isPayloadValid(payload)) {
      throw new Error('Invalid input')
    }

    // make sure user record is not being deleted at the moment
    const hasDisposalTaskQueued = await this.isEnqueuedForDisposal(enrollmentIdentifier)

    if (hasDisposalTaskQueued) {
      throw new Error('Facemap record with same identifier is being deleted.')
    }
  }

  async isEnqueuedForDisposal(enrollmentIdentifier: string, customLogger = null): Promise<boolean> {
    const { storage, logger } = this
    const log = customLogger || logger

    log.info('Checking disposal state for enrollment', { enrollmentIdentifier })

    try {
      const isDisposing = await storage.hasTasksQueued(
        DISPOSE_ENROLLMENTS_TASK,
        forEnrollment(enrollmentIdentifier, DisposeAt.AccountRemoved)
      )

      log.info('Got disposal state for enrollment', { enrollmentIdentifier, isDisposing })
      return isDisposing
    } catch (exception) {
      const error = exception.message

      log.warn("Couldn't check disposal state for enrollment", { enrollmentIdentifier, error })
      throw exception
    }
  }

  async getLicenseKey(licenseType, customLogger = null): Promise<any> {
    const { provider } = this

    if (!licenseType || !provider.isValidLicenseType(licenseType)) {
      throw new Error('Invalid input')
    }

    return provider.getLicenseKey(licenseType, customLogger)
  }

  async issueSessionToken(customLogger = null): Promise<any> {
    const { provider } = this

    return provider.issueToken(customLogger)
  }

  async enroll(user: any, enrollmentIdentifier: string, payload: any, customLogger = null): Promise<any> {
    const session = this.createEnrollmentSession(enrollmentIdentifier, user, customLogger)

    return session.enroll(payload)
  }

  async enqueueDisposal(user: any, enrollmentIdentifier: string, customLogger = null) {
    const { storage, adminApi, logger } = this
    const log = customLogger || logger

    log.info('Requested disposal for enrollment', { enrollmentIdentifier })

    const { gdAddress } = user
    const isUserWhitelisted = await adminApi.isVerified(gdAddress)

    if (isUserWhitelisted) {
      log.info('Wallet is whitelisted, making user non-whitelisted', { gdAddress })
      await adminApi.removeWhitelisted(gdAddress)
    }

    try {
      // don't pass user to task records to keep privacy
      const task = await scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.AccountRemoved)

      log.info('Enqueued enrollment disposal task', { enrollmentIdentifier, taskId: task._id })
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { e: exception, errMessage, enrollmentIdentifier }

      log.warn("Couldn't enqueue enrollment disposal task", logPayload)
      throw exception
    }
  }

  async disposeEnqueuedEnrollments(
    onProcessed: (identifier: string, exception?: Error) => void = noop,
    customLogger = null
  ): Promise<void> {
    const { Reauthenticate, AccountRemoved } = DisposeAt
    const { storage, adminApi, keepEnrollments, logger } = this
    const log = customLogger || logger

    const authenticationPeriod = await adminApi.getAuthenticationPeriod()
    const deletedAccountFilters = { 'subject.executeAt': AccountRemoved }

    if (keepEnrollments > 0) {
      deletedAccountFilters.createdAt = {
        $lte: moment()
          .subtract(keepEnrollments, 'hours')
          .toDate()
      }
    }

    const enqueuedAtFilters = {
      $or: [
        deletedAccountFilters,
        {
          'subject.executeAt': Reauthenticate,
          createdAt: {
            $lte: moment()
              .subtract(authenticationPeriod + 1, 'days') //give extra one day before we delete
              .toDate()
          }
        }
      ]
    }

    try {
      const enqueuedDisposalTasks = await storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, enqueuedAtFilters)
      const enqueuedTasksCount = enqueuedDisposalTasks.length

      if (enqueuedTasksCount <= 0) {
        log.info('No enqueued disposal tasks ready to processing found, skipping')
        return
      }

      const approximatedBatchSize = Math.round(enqueuedTasksCount / DISPOSE_BATCH_AMOUNT, 0)
      const disposeBatchSize = Math.min(DISPOSE_BATCH_MAXIMAL, Math.max(DISPOSE_BATCH_MINIMAL, approximatedBatchSize))
      const chunkedDisposalTasks = chunk(enqueuedDisposalTasks, disposeBatchSize)

      log.info('Enqueued disposal tasks fetched and ready to processing', {
        enqueuedTasksCount,
        disposeBatchSize,
        authenticationPeriod
      })

      await chunkedDisposalTasks.reduce(
        (queue, tasksBatch) => queue.then(() => this._executeDisposalBatch(tasksBatch, onProcessed, customLogger)),
        Promise.resolve()
      ) //iterate over batches. each batch is executed when previous batch promise resolves
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { e: exception, errMessage }

      log.warn('Error processing enrollments enqueued for disposal', logPayload)
      throw exception
    }
  }

  createEnrollmentSession(enrollmentIdentifier, user, customLogger = null) {
    const { provider, storage, adminApi } = this

    return new EnrollmentSession(enrollmentIdentifier, user, provider, storage, adminApi, customLogger)
  }

  /**
   * @private
   */
  async _executeDisposalBatch(
    disposalBatch: DelayedTaskRecord[],
    onProcessed: (identifier: string, exception?: Error) => void,
    customLogger: any
  ): Promise<void> {
    const { provider, storage, logger } = this
    const log = customLogger || logger
    const tasksSucceeded = []
    const tasksFailed = []

    await Promise.all(
      disposalBatch.map(async task => {
        const { _id: taskId, subject } = task
        const { enrollmentIdentifier } = subject
        try {
          const isEnrollmentIndexed = await provider.isEnrollmentIndexed(enrollmentIdentifier, customLogger)

          if (isEnrollmentIndexed) {
            await provider.dispose(enrollmentIdentifier, customLogger)
          } else {
            log.info("Enrollment isn't indexed in the 3D Database, skipping disposal", { enrollmentIdentifier })
          }

          tasksSucceeded.push(taskId)
          onProcessed(enrollmentIdentifier)
        } catch (exception) {
          tasksFailed.push(taskId)
          onProcessed(enrollmentIdentifier, exception)
        }
      })
    )

    if (tasksSucceeded.length) {
      await storage.removeDelayedTasks(tasksSucceeded)
    }

    if (tasksFailed.length) {
      await storage.failDelayedTasks(tasksFailed)
    }
  }
}

const enrollmentProcessors = new WeakMap()

export default (storage, log) => {
  if (!enrollmentProcessors.has(storage)) {
    log = log || logger.child({ from: 'EnrollmentProcessor' })
    const enrollmentProcessor = new EnrollmentProcessor(Config, storage, AdminWallet, log)

    enrollmentProcessor.registerProvier(getZoomProvider())
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  return enrollmentProcessors.get(storage)
}

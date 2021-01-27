// @flow
import { assign, chunk, noop } from 'lodash'

import AdminWallet from '../../blockchain/AdminWallet'
import { ClaimQueue } from '../../claimQueue/claimQueueAPI'
import { recoverPublickey } from '../../utils/eth'
import logger from '../../../imports/logger'

import { type IEnrollmentProvider } from './typings'
import { type DelayedTaskRecord } from '../../../imports/types'

import EnrollmentSession from './EnrollmentSession'

import getZoomProvider from './provider/ZoomProvider'
import createTaskService, { DisposeAt } from '../cron/TaskService'

// count of chunks pending tasks should (approximately) be split to
const DISPOSE_BATCH_AMOUNT = 10
// minimal & maximal chunk sizes
const DISPOSE_BATCH_MINIMAL = 10
const DISPOSE_BATCH_MAXIMAL = 50

class EnrollmentProcessor {
  logger = null
  storage = null
  adminApi = null
  queueApi = null
  tasksApi = null

  _provider = null

  get provider() {
    const { _provider } = this

    if (!_provider) {
      throw new Error(`Provider haven't registered.`)
    }

    return _provider
  }

  constructor(storage, adminApi, queueApi, tasksApi, logger) {
    assign(this, { logger, storage, adminApi, queueApi, tasksApi })
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
    const { logger, tasksApi } = this
    const log = customLogger || logger

    log.info('Checking disposal state for enrollment', { enrollmentIdentifier })

    try {
      const isDisposing = await tasksApi.hasDisposalTask(enrollmentIdentifier)

      log.info('Got disposal state for enrollment', { enrollmentIdentifier, isDisposing })
      return isDisposing
    } catch (exception) {
      const error = exception.message

      log.warn("Couldn't check disposal state for enrollment", { enrollmentIdentifier, error })
      throw exception
    }
  }

  async issueSessionToken(customLogger = null): Promise<any> {
    const { provider } = this

    return provider.issueToken(customLogger)
  }

  async enroll(user: any, enrollmentIdentifier: string, payload: any, customLogger = null): Promise<any> {
    const session = this.createEnrollmentSession(enrollmentIdentifier, user, customLogger)

    return session.enroll(payload)
  }

  async enqueueDisposal(user: any, enrollmentIdentifier: string, signature: string, customLogger = null) {
    const { adminApi, logger, tasksApi } = this
    const log = customLogger || logger

    log.info('Requested disposal for enrollment', { enrollmentIdentifier })

    const { gdAddress } = user
    const isUserWhitelisted = await adminApi.isVerified(gdAddress)

    if (isUserWhitelisted) {
      log.info('Wallet is whitelisted, making user non-whitelisted', { gdAddress })
      await adminApi.removeWhitelisted(gdAddress)
    }

    try {
      // recoverPublickey() also could throw so we're wrapping its call to try block
      const recovered = recoverPublickey(signature, enrollmentIdentifier, '')

      if (recovered.substr(2) !== enrollmentIdentifier.toLowerCase()) {
        throw new Error("Public key doesn't matches")
      }
    } catch {
      const signerException = new Error(
        `Unable to enqueue enrollment disposal: SigUtil unable to recover the message signer`
      )

      const logPayload = { e: signerException, errMessage: signerException.message, enrollmentIdentifier }

      log.warn("Enrollment disposal: Couldn't confirm signer of the enrollment identifier sent", logPayload)
      throw signerException
    }

    try {
      // don't pass user to task records to keep privacy
      const task = await tasksApi.scheduleDisposalTask(enrollmentIdentifier, DisposeAt.AccountRemoved)

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
    const { logger, tasksApi } = this
    const log = customLogger || logger

    try {
      const enqueuedDisposalTasks = await tasksApi.fetchDisposalTasks()
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
        disposeBatchSize
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
    const { provider, storage, adminApi, queueApi, tasksApi } = this

    return new EnrollmentSession(
      enrollmentIdentifier,
      user,
      provider,
      storage,
      adminApi,
      queueApi,
      tasksApi,
      customLogger
    )
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
const defaultLogger = logger.child({ from: 'EnrollmentProcessor' })

export default (storage, log = defaultLogger) => {
  if (!enrollmentProcessors.has(storage)) {
    const tasksService = createTaskService(storage)
    const enrollmentProcessor = new EnrollmentProcessor(storage, AdminWallet, ClaimQueue, tasksService, log)

    enrollmentProcessor.registerProvier(getZoomProvider())
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  return enrollmentProcessors.get(storage)
}

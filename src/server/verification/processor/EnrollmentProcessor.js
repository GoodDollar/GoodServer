// @flow
import { chunk, noop } from 'lodash'
import moment from 'moment'

import Config from '../../server.config'
import { GunDBPublic } from '../../gun/gun-middleware'
import AdminWallet from '../../blockchain/AdminWallet'
import { ClaimQueue } from '../../claimQueue/claimQueueAPI'
import { recoverPublickey } from '../../utils/eth'
import pino from '../../../imports/logger'

import { type IEnrollmentProvider } from './typings'
import { type DelayedTaskRecord } from '../../../imports/types'

import EnrollmentSession from './EnrollmentSession'
import ZoomProvider from './provider/ZoomProvider'

export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

// count of chunks pending tasks should (approximately) be split to
const DISPOSE_BATCH_AMOUNT = 10
// minimal & maximal chuk sizes
const DISPOSE_BATCH_MINIMAL = 10
const DISPOSE_BATCH_MAXIMAL = 50

class EnrollmentProcessor {
  gun = null
  logger = null
  storage = null
  adminApi = null
  queueApi = null
  keepEnrollments = null

  _provider = null

  get provider() {
    const { _provider } = this

    if (!_provider) {
      throw new Error(`Provider haven't registered.`)
    }

    return _provider
  }

  constructor(config, storage, adminApi, queueApi, gun, logger) {
    const { keepFaceVerificationRecords } = config

    this.gun = gun
    this.logger = logger
    this.storage = storage
    this.adminApi = adminApi
    this.queueApi = queueApi
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
      const isDisposing = await storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, {
        subject: enrollmentIdentifier
      })

      log.info('Got disposal state for enrollment', { enrollmentIdentifier, isDisposing })
      return isDisposing
    } catch (exception) {
      const error = exception.message

      log.warn("Coundn't check disposal state for enrollment", { enrollmentIdentifier, error })
      throw exception
    }
  }

  async enroll(user: any, enrollmentIdentifier: string, payload: any, customLogger = null): Promise<any> {
    const session = this.createEnrollmentSession(user, customLogger)

    return session.enroll(enrollmentIdentifier, payload)
  }

  async enqueueDisposal(user: any, enrollmentIdentifier: string, signature: string, customLogger = null) {
    const { storage, provider, adminApi, keepEnrollments, logger } = this
    const log = customLogger || logger

    log.info('Requested disposal for enrollment', { enrollmentIdentifier })

    const { gdAddress } = user
    const isUserWhitelisted = await adminApi.isVerified(gdAddress)

    if (isUserWhitelisted) {
      log.info('Walllet is whitelisted, making user non-whitelisted', { gdAddress })
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

    const enrollmentExists = await provider.enrollmentExists(enrollmentIdentifier, customLogger)

    if (!enrollmentExists) {
      log.info("Enrollment doesn't exists, skipping disposal", { enrollmentIdentifier })
      return
    }

    if (keepEnrollments <= 0) {
      const logMsg = "KEEP_FACE_VERIFICATION_RECORDS env variable isn't set, disposing enrollment immediately"

      log.info(logMsg, { enrollmentIdentifier })
      await provider.dispose(enrollmentIdentifier, customLogger)
      return
    }

    try {
      // dont pass user to task records to keep privacy
      const task = await storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, enrollmentIdentifier)

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
    const { storage, keepEnrollments, logger } = this
    const log = customLogger || logger

    const enqueuedAtFilters = {
      createdAt: {
        $lte: moment()
          .subtract(keepEnrollments, 'hours')
          .toDate()
      }
    }

    try {
      const enqueuedDisposalTasks = await storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, enqueuedAtFilters)
      const enqueuedTasksCount = enqueuedDisposalTasks.length
      const approximatedBatchSize = Math.round(enqueuedTasksCount / DISPOSE_BATCH_AMOUNT, 0)
      const disposeBatchSize = Math.min(DISPOSE_BATCH_MAXIMAL, Math.max(DISPOSE_BATCH_MINIMAL, approximatedBatchSize))
      const chunkedDisposalTasks = chunk(enqueuedDisposalTasks, disposeBatchSize)

      log.info('Enqueued disposal task fetched and ready to processing', {
        enqueuedTasksCount,
        disposeBatchSize
      })

      await chunkedDisposalTasks.reduce(
        (queue, tasksBatch) => queue.then(() => this._executeDisposalBatch(tasksBatch, onProcessed, customLogger)),
        Promise.resolve()
      )
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { e: exception, errMessage }

      log.warn('Error processing enrollments enqueued for disposal', logPayload)
      throw exception
    }
  }

  createEnrollmentSession(user, customLogger = null) {
    const { provider, storage, adminApi, queueApi, gun } = this

    return new EnrollmentSession(user, provider, storage, adminApi, queueApi, gun, customLogger)
  }

  /**
   * @private
   */
  async _executeDisposalBatch(
    disposalBatch: DelayedTaskRecord[],
    onProcessed: (identifier: string, exception?: Error) => void,
    customLogger: any
  ): Promise<void> {
    const { provider, storage } = this
    const tasksFailed = []
    const tasksSucceeded = []

    await Promise.all(
      disposalBatch.map(async task => {
        const { _id: taskId, subject: enrollmentIdentifier } = task

        try {
          await provider.dispose(enrollmentIdentifier, customLogger)

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

export default storage => {
  if (!enrollmentProcessors.has(storage)) {
    const logger = pino.child({ from: 'EnrollmentProcessor' })
    const enrollmentProcessor = new EnrollmentProcessor(Config, storage, AdminWallet, ClaimQueue, GunDBPublic, logger)

    enrollmentProcessor.registerProvier(ZoomProvider)
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  return enrollmentProcessors.get(storage)
}

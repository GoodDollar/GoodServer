// @flow
import { noop, chunk } from 'lodash'
import moment from 'moment'

import Config from '../../server.config'
import { GunDBPublic } from '../../gun/gun-middleware'
import AdminWallet from '../../blockchain/AdminWallet'

import { recoverPublickey } from '../../utils/eth'

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

  constructor(config, storage, adminApi, gun) {
    const { keepFaceVerificationRecords } = config

    this.gun = gun
    this.storage = storage
    this.adminApi = adminApi
    this.keepEnrollments = keepFaceVerificationRecords
  }

  registerProvier(provider: IEnrollmentProvider): void {
    this._provider = provider
  }

  validate(user: any, enrollmentIdenfitier: string, payload: any) {
    const { sessionId } = payload || {}
    const { provider } = this

    if (!user || !enrollmentIdenfitier || !payload || !sessionId || !provider.isPayloadValid(payload)) {
      throw new Error('Invalid input')
    }
  }

  async enroll(user: any, enrollmentIdenfitier: string, payload: any, customLogger = null): Promise<any> {
    const session = this.createEnrollmentSession(user, customLogger)

    return session.enroll(enrollmentIdenfitier, payload)
  }

  async enqueueDisposal(user: any, enrollmentIdentifier, signature, customLogger = noop) {
    const { storage, provider, keepEnrollments } = this
    const recovered = recoverPublickey(signature, enrollmentIdentifier, '')

    customLogger.info('Requested disposal for enrollment', { enrollmentIdentifier })

    if (recovered.substr(2) !== enrollmentIdentifier.toLowerCase()) {
      const signerException = new Error(
        `Unable to enqueue enrollment disposal: SigUtil unable to recover the message signer`
      )

      const logPayload = { e: signerException, errMessage: signerException.message, enrollmentIdentifier }

      customLogger.warn("Enrollment disposal: Couldn't confirm signer of the enrollment identifier sent", logPayload)
      throw signerException
    }

    const enrollmentExists = await provider.enrollmentExists(enrollmentIdentifier, customLogger)

    if (!enrollmentExists) {
      customLogger.info("Enrollment doesn't exists, skipping disposal", { enrollmentIdentifier })
      return
    }

    if (keepEnrollments <= 0) {
      const logMsg = "KEEP_FACE_VERIFICATION_RECORDS env variable isn't set, disposing enrollment immediately"

      customLogger.info(logMsg, { enrollmentIdentifier })
      await provider.dispose(enrollmentIdentifier, customLogger)
      return
    }

    try {
      const task = await storage.enqueueTask(user, DISPOSE_ENROLLMENTS_TASK, enrollmentIdentifier)

      customLogger.info('Enqueued enrollment disposal task', { enrollmentIdentifier, taskId: task._id })
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { e: exception, errMessage, enrollmentIdentifier }

      customLogger.warn("Couldn't enqueue enrollment disposal task", logPayload)
      throw exception
    }
  }

  async disposeEnqueuedEnrollments(
    onProcessed: (identifier: string, exception?: Error) => void = noop,
    customLogger = noop
  ): Promise<void> {
    const { storage, keepEnrollments } = this
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

      customLogger.info('Enqueued disposal task fetched and ready to processing', {
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

      customLogger.warn('Error processing enrollments enqueued for disposal', logPayload)
      throw exception
    }
  }

  createEnrollmentSession(user, customLogger = null) {
    const { provider, storage, adminApi, gun } = this

    return new EnrollmentSession(user, provider, storage, adminApi, gun, customLogger)
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
    const enrollmentProcessor = new EnrollmentProcessor(Config, storage, AdminWallet, GunDBPublic)

    enrollmentProcessor.registerProvier(ZoomProvider)
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  return enrollmentProcessors.get(storage)
}

// @flow
import { chunk, noop } from 'lodash'
import moment from 'moment'
import { toChecksumAddress } from 'web3-utils'

import Config from '../../server.config'
import { default as AdminWallet } from '../../blockchain/MultiWallet'
import logger from '../../../imports/logger'

import { type IEnrollmentProvider } from './typings'
import { type DelayedTaskRecord } from '../../../imports/types'

import EnrollmentSession from './EnrollmentSession'

import getZoomProvider from './provider/ZoomProvider'
import { DisposeAt, scheduleDisposalTask, DISPOSE_ENROLLMENTS_TASK, forEnrollment } from '../cron/taskUtil'

import { recoverPublickey } from '../../utils/eth'
import { FV_IDENTIFIER_MSG2 } from '../../login/login-middleware'
import { strcasecmp } from '../../utils/string'

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

    log.info('user uniqeness status:', { isUserWhitelisted, gdAddress })

    if (isUserWhitelisted) {
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

  async checkExistence(enrollmentIdentifier, v1EnrollmentIdentifier) {
    const [exists, v1Exists] = await Promise.all([
      this.isIdentifierExists(enrollmentIdentifier),
      v1EnrollmentIdentifier && this.isIdentifierExists(v1EnrollmentIdentifier)
    ])

    return { exists, v1Exists }
  }

  normalizeIdentifiers(enrollmentIdentifier, v1EnrollmentIdentifier = null) {
    return {
      identifier: enrollmentIdentifier.slice(0, 42),
      v1Identifier: v1EnrollmentIdentifier ? v1EnrollmentIdentifier.replace('0x', '') : null
    }
  }

  async verifyIdentifier(enrollmentIdentifier, gdAddress) {
    // check v2, v2 identifier is expected to be the whole signature
    if (enrollmentIdentifier.length < 42) {
      return
    }

    const signer = recoverPublickey(
      enrollmentIdentifier,
      FV_IDENTIFIER_MSG2({ account: toChecksumAddress(gdAddress) }),
      ''
    )

    if (!strcasecmp(signer, gdAddress)) {
      throw new Error(`identifier signer doesn't match user ${signer} != ${gdAddress}`)
    }
  }

  async isIdentifierExists(enrollmentIdentifier: string) {
    return this.provider.isEnrollmentExists(enrollmentIdentifier)
  }

  async isIdentifierIndexed(enrollmentIdentifier: string) {
    return this.provider.isEnrollmentIndexed(enrollmentIdentifier)
  }

  async dispose(enrollmentIdentifier: string, customLogger = null) {
    const { provider, logger } = this
    const log = customLogger || logger

    // check is enrollment indexed firstly (this is faster as server won't return facemap & base64 image)
    let requiresDisposal = await provider.isEnrollmentIndexed(enrollmentIdentifier, customLogger)

    if (!requiresDisposal) {
      // if not indexed it could be some low-quality or duplicate wasn't indexed
      // so we'll check is enrollment exists additionally.
      // otherwise dups & failed enrollments will be kept forever
      log.debug("Enrollment isn't indexed, checking for existence", { enrollmentIdentifier })
      requiresDisposal = await provider.isEnrollmentExists(enrollmentIdentifier, customLogger)
    }

    log.debug('Preparing to dispose enrollment', { enrollmentIdentifier, requiresDisposal })

    if (!requiresDisposal) {
      log.info("Enrollment isn't indexed nor exists in the 3D Database, skipping disposal", {
        enrollmentIdentifier
      })

      return
    }

    // .dispose() removes both search index & enrollment and catches "not found" errors gracefully
    // so if at least the enrollment itself exists, we need to call .dispose()
    await provider.dispose(enrollmentIdentifier, customLogger)
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
        $lte: moment().subtract(keepEnrollments, 'hours').toDate()
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
    const { storage } = this
    const tasksSucceeded = []
    const tasksFailed = []

    await Promise.all(
      disposalBatch.map(async task => {
        const { _id: taskId, subject } = task
        const { enrollmentIdentifier } = subject

        try {
          await this.dispose(enrollmentIdentifier, customLogger)

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

// @flow
import { bindAll, noop, omit } from 'lodash'
import { type IEnrollmentEventPayload } from './typings'
import logger from '../../../imports/logger'
import { DisposeAt, DISPOSE_ENROLLMENTS_TASK, forEnrollment, scheduleDisposalTask } from '../cron/taskUtil'

const log = logger.child({ from: 'EnrollmentSession' })

export default class EnrollmentSession {
  log = null
  user = null
  provider = null
  storage = null
  adminApi = null
  queueApi = null

  constructor(user, provider, storage, adminApi, queueApi, customLogger = null) {
    this.user = user
    this.provider = provider
    this.storage = storage
    this.adminApi = adminApi
    this.queueApi = queueApi
    this.log = customLogger || log

    bindAll(this, 'onEnrollmentProcessing')
  }

  async enroll(enrollmentIdentifier, payload: any): Promise<any> {
    const { log, user, provider, onEnrollmentProcessing } = this
    let result = { success: true }

    log.info('Enrollment session started', {
      enrollmentIdentifier,
      userIdentifier: user.loggedInAs,
      payload: omit(payload, 'faceMap', 'auditTrailImage', 'lowQualityAuditTrailImage')
    })

    try {
      await this.onEnrollmentStarted(enrollmentIdentifier)

      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing, log)

      log.info('Enrollment session completed with result:', enrollmentResult)

      await this.onEnrollmentCompleted(enrollmentIdentifier)
      Object.assign(result, { enrollmentResult })
    } catch (exception) {
      const { response, message } = exception
      const logLevel = message.toLowerCase().includes('liveness') ? 'warn' : 'error'

      result = {
        success: false,
        error: message,
        enrollmentResult: {
          ...(response || {}),
          isVerified: false
        }
      }

      log[logLevel]('Enrollment session failed with exception:', message, exception, { result })
      await this.onEnrollmentFailed(enrollmentIdentifier)
    }

    return result
  }

  async onEnrollmentStarted(enrollmentIdentifier) {
    await this._toggleDelayedTask(enrollmentIdentifier)
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { log } = this

    if ('isLive' in processingPayload) {
      log.info('Checking for liveness, matching and enrolling:', processingPayload)
    }

    if ('isDuplicate' in processingPayload) {
      log.info('Checking for duplicates:', processingPayload)
    }

    if ('isEnrolled' in processingPayload) {
      log.info('Adding enrollment to the 3D Database:', processingPayload)
    }
  }

  async onEnrollmentCompleted(enrollmentIdentifier) {
    const { user, storage, adminApi, queueApi, log } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    log.info('Whitelisting user:', loggedInAs)

    await Promise.all([
      queueApi.setWhitelisted(user, storage, log),
      adminApi.whitelistUser(gdAddress, profilePublickey),
      storage.updateUser({ identifier: loggedInAs, isVerified: true }),
      scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.Reauthenticate)
    ])

    log.info('Successfully whitelisted user:', loggedInAs)
  }

  async onEnrollmentFailed(enrollmentIdentifier) {
    await this._toggleDelayedTask(enrollmentIdentifier, true)
  }

  // eslint-disable-next-line require-await
  async _toggleDelayedTask(enrollmentIdentifier, unlock = false) {
    const { storage } = this
    const filters = forEnrollment(enrollmentIdentifier)
    const operation = unlock ? 'unlockDelayedTasks' : 'fetchTasksForProcessing'
    const taskPromise = storage[operation](DISPOSE_ENROLLMENTS_TASK, filters)

    if (unlock) {
      return taskPromise.catch(noop)
    }

    return taskPromise
  }
}

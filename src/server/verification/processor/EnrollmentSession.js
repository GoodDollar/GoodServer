// @flow
import { assign, bindAll, noop, omit } from 'lodash'
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
  sessionRef = null
  enrollmentId = null

  constructor(user, provider, storage, adminApi, queueApi, gun, customLogger = null) {
    this.gun = gun
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
      this.initialize(enrollmentIdentifier, payload)
      await this.onEnrollmentStarted()

      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing, log)

      log.info('Enrollment session completed with result:', enrollmentResult)

      await this.onEnrollmentCompleted()
      Object.assign(result, { enrollmentResult })
    } catch (exception) {
      const { response, message } = exception

      result = { success: false, error: message }

      if (response) {
        result.enrollmentResult = response
      }

      await this.onEnrollmentFailed(exception)

      if (message.toLowerCase().includes('liveness')) {
        log.warn('Enrollment session failed with exception:', message, exception, { result })
      } else {
        log.error('Enrollment session failed with exception:', message, exception, { result })
      }
    } finally {
      this.sessionRef = null
    }

    return result
  }

  initialize(enrollmentIdentifier: string, payload: any) {
    const { gun } = this
    const { sessionId } = payload

    // returning this to allow initialize &
    // get sessionRef via destructuring in a single call
    return assign(this, {
      enrollmentId: enrollmentIdentifier,
      sessionRef: gun.session(sessionId)
    })
  }

  async onEnrollmentStarted() {
    const { storage, sessionRef, enrollmentId } = this

    sessionRef.put({ isStarted: true })
    await storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentId))
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { sessionRef, log } = this

    if ('isDuplicate' in processingPayload) {
      log.info('Checking for duplicates:', processingPayload)
    }

    if ('isEnrolled' in processingPayload) {
      log.info('Checking for liveness and tried to enroll:', processingPayload)
    }

    sessionRef.put(processingPayload)
  }

  async onEnrollmentCompleted() {
    const { sessionRef, user, storage, adminApi, queueApi, enrollmentId, log } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    log.info('Whitelisting user:', loggedInAs)

    await Promise.all([
      queueApi.setWhitelisted(user, storage, log),
      adminApi.whitelistUser(gdAddress, profilePublickey),
      storage.updateUser({ identifier: loggedInAs, isVerified: true }),
      scheduleDisposalTask(storage, enrollmentId, DisposeAt.Reauthenticate)
    ])

    sessionRef.put({ isWhitelisted: true })
    log.info('Successfully whitelisted user:', loggedInAs)
  }

  async onEnrollmentFailed(exception) {
    const { sessionRef, enrollmentId, storage } = this
    const { message } = exception

    await storage.unlockDelayedTasks(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentId)).catch(noop)

    sessionRef.put({
      isLive: false,
      isEnrolled: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: message
    })
  }
}

// @flow
import { assign, bindAll, omit } from 'lodash'
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
  enrollmentIdentifier = null

  constructor(enrollmentIdentifier, user, provider, storage, adminApi, queueApi, customLogger = null) {
    this.log = customLogger || log

    assign(this, {
      user,
      provider,
      storage,
      adminApi,
      queueApi,
      enrollmentIdentifier
    })

    bindAll(this, 'onEnrollmentProcessing')
  }

  async enroll(payload: any): Promise<any> {
    const { log, user, provider, enrollmentIdentifier, onEnrollmentProcessing } = this
    let result = { success: true }

    log.info('Enrollment session started', {
      enrollmentIdentifier,
      userIdentifier: user.loggedInAs,
      payload: omit(payload, 'faceMap', 'faceScan', 'auditTrailImage', 'lowQualityAuditTrailImage')
    })

    try {
      await this.onEnrollmentStarted()

      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing, log)

      log.info('Enrollment session completed with result:', enrollmentResult)

      await this.onEnrollmentCompleted()
      assign(result, { enrollmentResult })
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
      await this.onEnrollmentFailed()
    }

    return result
  }

  async onEnrollmentStarted() {
    const { storage, enrollmentIdentifier } = this
    const filters = forEnrollment(enrollmentIdentifier)

    await storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, filters)
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

  async onEnrollmentCompleted() {
    const { user, storage, adminApi, queueApi, log, enrollmentIdentifier } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    const finalize = async (action, errorLogMessage) => {
      try {
        return await action()
      } catch (e) {
        log.error(errorLogMessage, e.message, e)
        throw e
      }
    }

    log.info('Whitelisting user:', { loggedInAs })

    await Promise.all([
      storage.updateUser({ identifier: loggedInAs, isVerified: true }),
      finalize(() => queueApi.setWhitelisted(user, storage, log), 'claim queue update failed'),
      finalize(() => adminApi.whitelistUser(gdAddress, profilePublickey), 'whitelisting after fv failed'),

      finalize(
        () => scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.Reauthenticate),
        'adding facemap to re-auth dispose queue failed:'
      )
    ])

    log.info('Successfully whitelisted user:', { loggedInAs })
  }

  async onEnrollmentFailed() {
    const { storage, enrollmentIdentifier } = this
    const filters = forEnrollment(enrollmentIdentifier)

    await storage.unlockDelayedTasks(DISPOSE_ENROLLMENTS_TASK, filters)
  }
}

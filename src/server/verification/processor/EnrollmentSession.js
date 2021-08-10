// @flow
import { assign, bindAll, omit } from 'lodash'
import { type IEnrollmentEventPayload } from './typings'
import logger from '../../../imports/logger'
import { DisposeAt, DISPOSE_ENROLLMENTS_TASK, forEnrollment, scheduleDisposalTask } from '../cron/taskUtil'
import { shouldLogVerificaitonError } from '../utils/logger'
import { Mautic } from '../../mautic/mauticAPI'

const log = logger.child({ from: 'EnrollmentSession' })

export default class EnrollmentSession {
  log = null
  user = null
  provider = null
  storage = null
  adminApi = null
  enrollmentIdentifier = null

  constructor(enrollmentIdentifier, user, provider, storage, adminApi, customLogger = null) {
    this.log = customLogger || log

    assign(this, {
      user,
      provider,
      storage,
      adminApi,
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
      const logArgs = ['Enrollment session failed with exception:', message, exception, { result }]

      result = {
        success: false,
        error: message,
        enrollmentResult: {
          ...(response || {}),
          isVerified: false
        }
      }

      if (shouldLogVerificaitonError(exception)) {
        log.error(...logArgs)
      } else {
        log.warn(...logArgs)
      }

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
    const { user, storage, adminApi, log, enrollmentIdentifier } = this
    const { gdAddress, profilePublickey, loggedInAs, mauticId } = user

    log.info('Whitelisting user:', { loggedInAs })

    await Promise.all([
      storage.updateUser({ identifier: loggedInAs, isVerified: true }),
      Mautic.setWhitelisted(mauticId, log).catch(e =>
        log.error('mautic setWhitelisted after fv failed', e.message, e, { user })
      ),
      adminApi
        .whitelistUser(gdAddress, profilePublickey)
        .catch(e => log.error('whitelisting after fv failed', e.message, e, { user })),

      scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.Reauthenticate).catch(e =>
        log.warn('adding facemap to re-auth dispose queue failed:', e.message, e)
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

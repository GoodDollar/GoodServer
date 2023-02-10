// @flow
import { assign, bindAll, get, omit, over } from 'lodash'
import fs from 'fs'
import { type IEnrollmentEventPayload } from './typings'
import logger from '../../../imports/logger'
import { DisposeAt, DISPOSE_ENROLLMENTS_TASK, forEnrollment, scheduleDisposalTask } from '../cron/taskUtil'
import { shouldLogVerificaitonError } from '../utils/logger'
import OnGage from '../../crm/ongage'
import conf from '../../server.config'

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

    bindAll(this, 'onEnrollmentProcessing', '_logWrap')
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

      // TODO: remove this after research
      if (conf.env.startsWith('prod') && get(exception, 'response.isDuplicate', false)) {
        try {
          const fileName = `${enrollmentIdentifier}-${exception.response.duplicate.identifier}`
          const { auditTrailBase64 } = await this.provider.getEnrollment(exception.response.duplicate.identifier)
          let a = Buffer.from(payload.auditTrailImage, 'base64')
          let b = Buffer.from(auditTrailBase64, 'base64')
          fs.writeFileSync(fileName + '-a.jpg', a)
          fs.writeFileSync(fileName + '-b.jpg', b)
          log.debug('wrote duplicate file:', { fileName })
        } catch (e) {
          log.error('failed writing duplicate files', e.message, e)
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
    const { user, storage, adminApi, log, enrollmentIdentifier, _logWrap } = this
    const { gdAddress, profilePublickey, loggedInAs, crmId, chainId } = user

    const whitelistTask = _logWrap(
      () => adminApi.whitelistUser(gdAddress, profilePublickey || gdAddress, chainId, log),
      'Successfully whitelisted user:',
      'whitelisting after fv failed'
    )()

    const whitelistingTasks = [
      () => storage.updateUser({ identifier: loggedInAs, isVerified: true }),

      _logWrap(
        () => scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.Reauthenticate),
        null,
        'adding facemap to re-auth dispose queue failed:',
        { enrollmentIdentifier },
        {}
      ),

      _logWrap(
        () => adminApi.topWallet(gdAddress, 'all', log),
        'topwallet after fv success',
        'topwallet after fv failed'
      )
    ]

    if (crmId) {
      whitelistingTasks.push(
        _logWrap(
          () => OnGage.setWhitelisted(crmId, log),
          'CRM setWhitelisted after fv success',
          'CRM setWhitelisted after fv failed',
          { crmId }
        )
      )
    } else {
      log.warn('missing crmId', { user })
    }

    log.info('Whitelisting user:', { loggedInAs })
    over(whitelistingTasks)() //dont wait on tasks that can be done in background
    await whitelistTask // wait only for whitelisting to be done successfully
  }

  async onEnrollmentFailed() {
    const { storage, enrollmentIdentifier } = this
    const filters = forEnrollment(enrollmentIdentifier)

    await storage.unlockDelayedTasks(DISPOSE_ENROLLMENTS_TASK, filters)
  }

  _logWrap(fn, successMsg, failedMsg, logPayload = null, errorPayload = null) {
    const { user, log } = this
    const { loggedInAs } = user

    return () =>
      fn()
        .then(() => successMsg && log.info(successMsg, logPayload || { loggedInAs }))
        .catch(e => failedMsg && log.error(failedMsg, e.message, e, errorPayload || { user }))
  }
}

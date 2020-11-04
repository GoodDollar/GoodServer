// @flow
import { bindAll, omit } from 'lodash'
import { type IEnrollmentEventPayload } from './typings'
import logger from '../../../imports/logger'

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
      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing, log)

      log.info('Enrollment session completed with result:', enrollmentResult)

      await this.onEnrollmentCompleted()
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
    }

    return result
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { log } = this

    if ('isDuplicate' in processingPayload) {
      log.info('Checking for duplicates:', processingPayload)
    }

    if ('isEnrolled' in processingPayload) {
      log.info('Checking for liveness and tried to enroll:', processingPayload)
    }
  }

  async onEnrollmentCompleted() {
    const { user, storage, adminApi, queueApi, log } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    log.info('Whitelisting user:', loggedInAs)

    await Promise.all([
      queueApi.setWhitelisted(user, storage, log),
      adminApi.whitelistUser(gdAddress, profilePublickey),
      storage.updateUser({ identifier: loggedInAs, isVerified: true })
    ])

    log.info('Successfully whitelisted user:', loggedInAs)
  }
}

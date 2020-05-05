// @flow
import { bindAll } from 'lodash'
import { type IEnrollmentEventPayload } from './typings'

import logger from '../../../imports/logger'

const log = logger.child({ from: 'EnrollmentSession' })

export default class EnrollmentSession {
  log = null
  user = null
  provider = null
  storage = null
  adminApi = null
  sessionRef = null

  constructor(user, provider, storage, adminApi, gun, customLogger = null) {
    this.gun = gun
    this.user = user
    this.provider = provider
    this.storage = storage
    this.adminApi = adminApi
    this.log = customLogger || log

    bindAll(this, 'onEnrollmentProcessing')
  }

  async enroll(enrollmentIdentifier, payload: any): Promise<any> {
    const { log, provider, onEnrollmentProcessing } = this
    let result = { success: true }

    log.info('Enrollment session started', { enrollmentIdentifier, payload })

    try {
      this.initialize(payload)
      this.onEnrollmentStarted()

      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)

      log.info('Enrollment session completed with result:', enrollmentResult)

      await this.onEnrollmentCompleted()
      Object.assign(result, { enrollmentResult })
    } catch (exception) {
      const { response, message } = exception

      result = { success: false, error: message }

      if (response) {
        result.enrollmentResult = response
      }

      log.info('Enrollment session failed with exception:', result)

      this.onEnrollmentFailed(exception)
    } finally {
      this.sessionRef = null
    }

    return result
  }

  initialize(payload: any) {
    const { gun } = this
    const { sessionId } = payload

    this.sessionRef = gun.session(sessionId)
    // returning this to allow initialize &
    // get sessionRef via destructuring in a single call
    return this
  }

  onEnrollmentStarted() {
    const { sessionRef } = this

    sessionRef.put({ isStarted: true })
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { sessionRef, log } = this

    if ('isDuplicate' in processingPayload) {
      log.info('Checked for duplicates:', processingPayload)
    }

    if ('isEnrolled' in processingPayload) {
      log.info('Checked for liveness and tried to enroll:', processingPayload)
    }

    sessionRef.put(processingPayload)
  }

  async onEnrollmentCompleted() {
    const { sessionRef, user, storage, adminApi, log } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    log.info('Whitelistening user:', loggedInAs)

    await Promise.all([
      adminApi.whitelistUser(gdAddress, profilePublickey),
      storage.updateUser({ identifier: loggedInAs, isVerified: true })
    ])

    sessionRef.put({ isWhitelisted: true })
    log.info('Successfully whitelisted user:', loggedInAs)
  }

  onEnrollmentFailed(exception) {
    const { sessionRef } = this
    const { message } = exception

    sessionRef.put({
      isLive: false,
      isEnrolled: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: message
    })
  }
}

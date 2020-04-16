// @flow
import { bindAll } from 'lodash'
import { type IEnrollmentEventPayload } from './typings'

export default class EnrollmentSession {
  user = null
  provider = null
  storage = null
  adminApi = null

  constructor(user, provider, storage, adminApi, gun) {
    this.gun = gun
    this.user = user
    this.provider = provider
    this.storage = storage
    this.adminApi = adminApi

    bindAll(this, 'onEnrollmentProcessing')
  }

  async enroll(enrollmentIdentifier, payload: any): Promise<any> {
    const { gun, provider, user, onEnrollmentProcessing } = this
    const { sessionId } = payload
    const sessionRef = gun.session(sessionId)
    let result = { success: true }

    this.sessionRef = sessionRef
    this.onEnrollmentStarted()

    try {
      const enrollmentResult = await provider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)

      await this.onEnrollmentCompleted()
      Object.assign(result, { enrollmentResult })
    } catch (exception) {
      const { response, message } = exception

      result = { success: false, error: message }

      if (response) {
        result.enrollmentResult = response
      }

      this.onEnrollmentFailed(exception)
    } finally {
      this.sessionRef = null
    }

    return result
  }

  onEnrollmentStarted() {
    const { sessionRef } = this

    sessionRef.put({ isStarted: true })
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { sessionRef } = this

    sessionRef.put(processingPayload)
  }

  async onEnrollmentCompleted() {
    const { sessionRef, user, storage, adminApi } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    try {
      await Promise.all([
        adminApi.whitelistUser(gdAddress, profilePublickey),
        storage.updateUser({ identifier: loggedInAs, isVerified: true })
      ])

      sessionRef.put({ isWhitelisted: true })
    } catch ({ message }) {
      sessionRef.put({ isWhitelisted: false, isError: message })
    }
  }

  onEnrollmentFailed(exception) {
    const { sessionRef } = this
    const { message } = exception

    sessionRef.put({
      isLive: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: message
    })
  }
}

// @flow

import { GunDBPublic } from '../../gun/gun-middleware'
import AdminWallet from '../../blockchain/AdminWallet'

import { EnrollmentProviders, type EnrollmentProvider, type IEnrollmentEventPayload } from './typings'

class EnrollmentProcessor {
  static providersFactories = {}

  static registerProviers(factories: { [name: EnrollmentProvider]: Function }) {
    this.providersFactories = factories
  }

  user = null
  storage = null
  sessionRef = null

  constructor(user, storage, adminApi) {
    this.user = user
    this.storage = storage
    this.adminApi = adminApi
  }

  validate(payload: any, providerType: EnrollmentProvider = EnrollmentProviders.Kairos) {
    const { user } = this
    const identifier = user || {}
    const { sessionId } = payload || {}
    const providerInstance = this._createProvider(providerType)

    if (!user || !identifier || !payload || !sessionId || !providerInstance.isPayloadValid(payload)) {
      throw new Error('Invalid input')
    }
  }

  async enroll(payload: any, providerType: EnrollmentProvider = EnrollmentProviders.Kairos) {
    const { sessionId } = payload
    const sessionRef = GunDBPublic.session(sessionId)
    const providerInstance = this._createProvider(providerType)

    this.sessionRef = sessionRef

    try {
      const enrollmentResult = await providerInstance.enroll(payload, this.user.identifier)

      return { ok: 1, isVerified: true, enrollmentResult }
    } catch ({ response, message }) {
      const failedResponse = { ok: 0, isVerified: false, error: message }

      if (response) {
        failedResponse.enrollmentResult = response
      }

      sessionRef.put({
        isLive: false,
        isDuplicate: true,
        isWhitelisted: false,
        isError: message
      })

      return failedResponse
    } finally {
      this.sessionRef = null
    }
  }

  onEnrollmentStarted() {
    const { sessionRef } = this

    sessionRef.put({ isStarted: true })
  }

  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload) {
    const { sessionRef } = this

    sessionRef.put(processingPayload)
  }

  async onEnrollmentCompleted(completedPayload: IEnrollmentEventPayload) {
    const { sessionRef, user, storage, adminApi } = this
    const { gdAddress, profilePublickey, loggedInAs } = user

    this.onEnrollmentProcessing(completedPayload)

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

  _createProvider(type: EnrollmentProvider) {
    let providerInstance
    const { providersFactories } = this.constructor
    const providerFactory = providersFactories[type]

    if (!providerFactory) {
      throw new Error(`Provider '${type}' haven't registered.`)
    }

    providerInstance = providerFactory()
    providerInstance.subscribe(this)

    return providerInstance
  }
}

EnrollmentProcessor.registerProviers({
  [EnrollmentProviders.Zoom]: require('./provider/ZoomProvider'),
  [EnrollmentProviders.Kairos]: require('./provider/KairosProvider')
})

export default (user, storage) => new EnrollmentProcessor(user, storage, AdminWallet)

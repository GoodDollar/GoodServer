// @flow
import AdminWallet from '../../blockchain/AdminWallet'

import { type IEnrollmentProvider } from './typings'

import EnrollmentSession from './EnrollmentSession'
import ZoomProvider from './provider/ZoomProvider'

class EnrollmentProcessor {
  storage = null
  adminApi = null
  _provider = null

  get provider() {
    const { _provider } = this

    if (!_provider) {
      throw new Error(`Provider haven't registered.`)
    }

    return _provider
  }

  constructor(storage, adminApi) {
    this.storage = storage
    this.adminApi = adminApi
  }

  registerProvier(provider: IEnrollmentProvider): void {
    this._provider = provider
  }

  validate(user: any, enrollmentIdenfitier: string, payload: any) {
    const { sessionId } = payload || {}
    const { provider } = this

    if (!user || !enrollmentIdenfitier || !payload || !sessionId || !provider.isPayloadValid(payload)) {
      throw new Error('Invalid input')
    }
  }

  async enroll(user: any, enrollmentIdenfitier: string, payload: any): Promise<any> {
    const { provider, storage, adminApi } = this
    const session = new EnrollmentSession(user, provider, storage, adminApi)

    return session.enroll(enrollmentIdenfitier, payload)
  }
}

const enrollmentProcessors = new WeakMap()

export default storage => {
  if (!enrollmentProcessors.has(storage)) {
    const enrollmentProcessor = new enrollmentProcessor(storage, AdminWallet)

    enrollmentProcessor.registerProvier(ZoomProvider)
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  enrollmentProcessors.get(storage)
}

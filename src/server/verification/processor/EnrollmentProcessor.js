// @flow
import AdminWallet from '../../blockchain/AdminWallet'
import { GunDBPublic } from '../../gun/gun-middleware'
import { recoverPublickey } from '../../utils/eth'

import { type IEnrollmentProvider } from './typings'

import EnrollmentSession from './EnrollmentSession'
import ZoomProvider from './provider/ZoomProvider'

class EnrollmentProcessor {
  gun = null
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

  constructor(storage, adminApi, gun) {
    this.gun = gun
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
    const { provider, storage, adminApi, gun } = this
    const session = new EnrollmentSession(user, provider, storage, adminApi, gun)

    return session.enroll(enrollmentIdenfitier, payload)
  }

  async enqueueDisposal(enrollmentIdentifier, signature) {
    const { provider, storage } = this // eslint-disable-line
    const recovered = recoverPublickey(signature, enrollmentIdentifier, '')

    if (recovered.substr(2) !== enrollmentIdentifier.toLowerCase()) {
      throw new Error(
        `Unable to enqueue enrollment '${enrollmentIdentifier}' disposal: ` +
          `SigUtil unable to recover the message signer`
      )
    }

    const enrollmentExists = await provider.enrollmentExists(enrollmentIdentifier)

    if (enrollmentExists) {
      // TODO: enqueue enrollmentIdentifier to the corresponding mongo collection using storage
    }
  }

  async dispose(enrollmentIdentifier) {
    const { provider, storage } = this // eslint-disable-line

    await provider.dispose(enrollmentIdentifier)
    // TODO: remove enrollmentIdentifier from the corresponding mongo collection using storage
  }
}

const enrollmentProcessors = new WeakMap()

export default storage => {
  if (!enrollmentProcessors.has(storage)) {
    const enrollmentProcessor = new EnrollmentProcessor(storage, AdminWallet, GunDBPublic)

    enrollmentProcessor.registerProvier(ZoomProvider)
    enrollmentProcessors.set(storage, enrollmentProcessor)
  }

  return enrollmentProcessors.get(storage)
}

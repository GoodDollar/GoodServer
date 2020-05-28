// @flow
import { noop } from 'lodash'

import Config from '../../server.config'
import { GunDBPublic } from '../../gun/gun-middleware'
import AdminWallet from '../../blockchain/AdminWallet'

import { recoverPublickey } from '../../utils/eth'

import { type IEnrollmentProvider } from './typings'

import EnrollmentSession from './EnrollmentSession'
import ZoomProvider from './provider/ZoomProvider'

export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

class EnrollmentProcessor {
  gun = null
  storage = null
  adminApi = null
  keepEnrollments = null

  _provider = null

  get provider() {
    const { _provider } = this

    if (!_provider) {
      throw new Error(`Provider haven't registered.`)
    }

    return _provider
  }

  constructor(storage, adminApi, gun) {
    const { keepFaceVerificationRecords } = Config

    this.gun = gun
    this.storage = storage
    this.adminApi = adminApi
    this.keepEnrollments = keepFaceVerificationRecords
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

  async enroll(user: any, enrollmentIdenfitier: string, payload: any, customLogger = null): Promise<any> {
    const session = this.createEnrollmentSession(user, customLogger)

    return session.enroll(enrollmentIdenfitier, payload)
  }

  async enqueueDisposal(enrollmentIdentifier, signature, customLogger = null) {
    const { provider, keepEnrollments } = this
    const recovered = recoverPublickey(signature, enrollmentIdentifier, '')

    if (recovered.substr(2) !== enrollmentIdentifier.toLowerCase()) {
      throw new Error(`Unable to enqueue enrollment disposal: SigUtil unable to recover the message signer`)
    }

    const enrollmentExists = await provider.enrollmentExists(enrollmentIdentifier, customLogger)

    if (enrollmentExists) {
      // if KEEP_FACE_VERIFICATION_RECORDS env var lte 0 - delete face record immediately
      if (keepEnrollments <= 0) {
        await provider.dispose(enrollmentIdentifier, customLogger)
        return
      }

      // TODO: enqueue enrollmentIdentifier to the corresponding mongo collection using storage
      // add current timestamp to each collection item
    }
  }

  async disposeEnqueuedEnrollments(onProcessed: (identifier: string, exception?: Error) => void): Promise<void> {
    noop(onProcessed) // eslint / lgtm stub
    // TODO

    // 1. get all items from enqueued enrollment identifiers collection
    //    which were added this.keepEnrollments hours ago or earlier

    // 2. split onto chunks by 10-20 (could calculate chunk size
    // as some percent of total amount but not out of 10 ... 50 range)

    // 3. traverse chunks via for...in or await chunks.reduce (if lint rules disallows await in loop)

    // 4. for each identifiers in chunk:
    // - call await provider.dispose(identifier)
    // - wrap to try catch
    // - on error exclude item from chunk, call onProcessed for it and do not rethrow error
    // - success just call onProcessed

    // 5. aggregate async calls from pt 4. via Promise.all and await them

    // 6. execute deleteMany for items have rest in the chunk
    // (items sucessfully disposed on the Zoom)
  }

  createEnrollmentSession(user, customLogger = null) {
    const { provider, storage, adminApi, gun } = this

    return new EnrollmentSession(user, provider, storage, adminApi, gun, customLogger)
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

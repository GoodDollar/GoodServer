// @flow
import { map, pick } from 'lodash'
import EnrollmentProvider from '.'
import KairosAPI from '../../api/KairosAPI'

class KairosProvider extends EnrollmentProvider {
  api = null

  constructor(api) {
    super()
    this.api = api
  }

  isPayloadValid(payload: any): boolean {
    const { images } = payload

    return Array.isArray(images) && images.length > 0
  }

  async enroll(payload: any, enrollmentIdentifier: string) {
    const { images, sessionId } = payload
    const imagesAsBase64 = map(images, 'base64')

    this.emitStarted()

    const response = await this.api.addIfUniqueAndAlive(
      enrollmentIdentifier,
      sessionId,
      imagesAsBase64,
      (_, __, payload) => {
        const { ok, isEnroll } = payload
        const eventPayload = pick(payload, 'isDuplicate', 'isLive', 'isEnroll')

        this.emitProcessing(eventPayload)

        if (ok && isEnroll) {
          this.emitCompleted(eventPayload)
        }
      }
    )

    const { ok, error } = response

    if (!ok) {
      const exception = new Error(error)

      exception.response = response
      throw exception
    }

    return response
  }
}

export default () => new KairosProvider(KairosAPI)

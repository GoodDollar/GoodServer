// @flow
import { map } from 'lodash'

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

    return this.api.addIfUniqueAndAlive(
      enrollmentIdentifier,
      sessionId,
      imagesAsBase64,
      (_, __, { ok, isDuplicate, isLive, isEnroll }) => {
        const eventPayload = { isDuplicate, isLive, isEnroll }

        if (ok && isEnroll) {
          this.emitCompleted(eventPayload)
          return
        }

        this.emitProcessing(eventPayload)
      }
    )
  }
}

export default () => new KairosProvider(KairosAPI)

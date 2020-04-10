// @flow
import { pick, findKey } from 'lodash'

import { type IEnrollmentProvider } from '../typings'

import ZoomAPI from '../../api/ZoomAPI.js'

class ZoomProvider implements IEnrollmentProvider {
  api = null

  constructor(api) {
    super()

    this.api = api
  }

  isPayloadValid(payload: any): boolean {
    return !findKey(
      pick(payload, ['faceMap', 'lowQualityAuditTrailImage', 'auditTrailImage']),
      fieldValue => !fieldValue
    )
  }

  async enroll(
    enrollmentIdentifier: string,
    payload: any,
    onEnrollmentProcessing: (payload: IEnrollmentEventPayload) => void | Promise<void>
  ): Promise<any> {
    let eventPayload
    let enrollmentResponse
    const requestPayload = { ...payload, enrollmentIdentifier }

    this.emitStarted()

    try {
      enrollmentResponse = await this.api.submitEnrollment(requestPayload)
      eventPayload = this._analyzeEnrollmentResponse(enrollmentResponse)
      onEnrollmentProcessing(eventPayload)

      return enrollmentResponse
    } catch (exception) {
      const { response } = exception

      if (response) {
        eventPayload = this._analyzeEnrollmentResponse(response)
        onEnrollmentProcessing(eventPayload)
      }

      throw exception
    }
  }

  _analyzeEnrollmentResponse(enrollmentResponse) {
    const { subCode, isEnrolled, livenessStatus } = enrollmentResponse

    const isEnroll = isEnrolled
    const isLive = 0 === livenessStatus
    const isDuplicate = 'nameCollision' === subCode

    return { isLive, isDuplicate, isEnroll }
  }
}

export default new ZoomProvider(ZoomAPI)

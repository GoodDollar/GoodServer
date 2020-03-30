// @flow
import { pick, findKey } from 'lodash'

import EnrollmentProvider from '.'
import ZoomAPI  from '../../api/ZoomAPI'

class ZoomProvider extends EnrollmentProvider {
  api = null

  constructor(api) {
    super()

    this.api = api
  }

  isPayloadValid(payload: any): boolean {
    return !findKey(pick(payload, [
      'faceMap',
      'lowQualityAuditTrailImage',
      'auditTrailImage',
      'userAgent'
    ]), fieldValue => !fieldValue)
  }

  async enroll(payload: any, enrollmentIdentifier: string) {
    let eventPayload;
    let enrollmentResponse;
    const requestPayload = { ...payload, enrollmentIdentifier };

    this.emitStarted();

    try {
      enrollmentResponse = await this.api.submitEnrollment(requestPayload)
      eventPayload = this._analyzeEnrollmentResponse(enrollmentResponse)

      this.emitProcessing(eventPayload);
      this.emitCompleted(eventPayload);

      return enrollmentResponse;
    } catch (exception) {
      const { response } = exception;

      if (response) {
        eventPayload = this._analyzeEnrollmentResponse(response)

        this.emitProcessing(eventPayload);
      }

      throw exception;
    }
  }

  _analyzeEnrollmentResponse(enrollmentResponse) {
    const {
      subCode, isEnrolled, glasses,
      isLowQuality, livenessStatus,
    } = enrollmentResponse;

    const isEnroll = isEnrolled;
    const isLive = 0 === livenessStatus;
    const isDuplicate = 'nameCollision' === subCode;

    return { isLive, isDuplicate, isEnroll }
  }
}

module.exports = () => new ZoomProvider(ZoomAPI)

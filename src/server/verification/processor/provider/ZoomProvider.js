// @flow
import ZoomAPI from '../../api/ZoomAPI.js'

import { type IEnrollmentProvider } from '../typings'

class ZoomProvider implements IEnrollmentProvider {
  api = null

  constructor(api) {
    this.api = api
  }

  isPayloadValid(payload: any): boolean {
    return !['faceMap', 'lowQualityAuditTrailImage', 'auditTrailImage'].some(field => !payload[field])
  }

  async enroll(
    enrollmentIdentifier: string,
    payload: any,
    onEnrollmentProcessing: (payload: IEnrollmentEventPayload) => void | Promise<void>
  ): Promise<any> {
    const { api } = this
    // send event to onEnrollmentProcessing
    const notifyProcessor = async eventPayload => onEnrollmentProcessing(eventPayload)

    // throws custom exception related to the predefined verification cases
    // e.g. livenes wasn't passed, duplicate found etc
    const throwCustomException = (errorMessage, errorResponse) => {
      const exception = new Error(errorMessage)

      exception.response = { isVerified: false, ...errorResponse }
      throw exception
    }

    // 1. checking liveness
    try {
      await api.detectLiveness(payload)
      // if passed - notifying and going further
      await notifyProcessor({ isLive: true })
    } catch (exception) {
      const { message, response } = exception

      // rethrowing unexpected errors (e.g. no conneciton or service error)
      if (!response) {
        throw exception
      }

      // if api have returned failed response
      // notifying about it and returning custom exception
      const isLive = false

      await notifyProcessor({ isLive })
      throwCustomException(message, { isLive, ...response })
    }

    // 2. checking for duplicates
    // we don't need to catch specific cases so
    // we don't wrapping call to try catch
    // any unexpected errors will be automatically rethrown
    const { results } = await api.faceSearch(payload)
    // excluding own enrollmentIdentifier
    const duplicate = results.find(
      ({ enrollmentIdentifier: matchId }) => matchId.toLowerCase() !== enrollmentIdentifier.toLowerCase()
    )
    // if there're at least one record left - we have a duplicate
    const isDuplicate = !!duplicate

    // notifying about duplicates found or not
    await notifyProcessor({ isDuplicate })

    if (duplicate) {
      const duplicateFoundMessage = `Duplicate with identifier '${duplicate.enrollmentIdentifier}' found.`

      // if duplicate found - throwing corresponding error
      throwCustomException(duplicateFoundMessage, { isDuplicate, ...duplicate })
    }

    let enrollmentResult
    let alreadyEnrolled = false

    // 3. performing enroll
    try {
      enrollmentResult = await api.submitEnrollment({ ...payload, enrollmentIdentifier })
    } catch (exception) {
      const { response, message } = exception

      // rethrowing unexpected errors (e.g. no conneciton or service error)
      if (!response) {
        throw exception
      }

      // if exception isn't related to the case when
      // facemap is just already enrolled
      if ('nameCollision' !== response.subCode) {
        const isEnrolled = false

        // then notifying & throwing custom exception
        await notifyProcessor({ isEnrolled })
        throwCustomException(message, { isEnrolled, ...response })
      }

      // otherwise going further (as dupliucate check is already passed)
      // and facemap was just already enrolled
      enrollmentResult = response
      alreadyEnrolled = true
    }

    // notifying about successfull enrollment
    await notifyProcessor({ isEnrolled: true })
    // returning successfull result
    return { isVerified: true, alreadyEnrolled, ...enrollmentResult }
  }

  async enrollmentExists(enrollmentIdentifier: string): Promise<boolean> {
    try {
      await this.api.readEnrollment(enrollmentIdentifier)
    } catch (exception) {
      const { subCode } = exception.response || {}

      if ('facemapNotFound' === subCode) {
        return false
      }

      throw exception
    }

    return true
  }

  async dispose(enrollmentIdentifier: string): Promise<void> {
    try {
      await this.api.disposeEnrollment(enrollmentIdentifier)
    } catch (exception) {
      const { subCode } = exception.response || {}

      if ('facemapNotFound' === subCode) {
        return
      }

      throw exception
    }
  }
}

export default new ZoomProvider(ZoomAPI)

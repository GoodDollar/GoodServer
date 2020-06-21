// @flow
import { pick, omit } from 'lodash'

import ZoomAPI from '../../api/ZoomAPI.js'
import logger from '../../../../imports/logger'

import { type IEnrollmentProvider } from '../typings'

class ZoomProvider implements IEnrollmentProvider {
  api = null
  logger = null

  constructor(api, logger) {
    this.api = api
    this.logger = logger
  }

  isPayloadValid(payload: any): boolean {
    return !['faceMap', 'lowQualityAuditTrailImage', 'auditTrailImage'].some(field => !payload[field])
  }

  async enroll(
    enrollmentIdentifier: string,
    payload: any,
    onEnrollmentProcessing: (payload: IEnrollmentEventPayload) => void | Promise<void>,
    customLogger = null
  ): Promise<any> {
    const { api, logger } = this
    const log = customLogger || logger
    // send event to onEnrollmentProcessing
    const notifyProcessor = async eventPayload => onEnrollmentProcessing(eventPayload)

    // throws custom exception related to the predefined verification cases
    // e.g. livenes wasn't passed, duplicate found etc
    const throwCustomException = (customMessage, customResponse, zoomResponse = {}) => {
      const exception = new Error(customMessage)

      exception.response = {
        // removing all large data (e.g. images , facemaps)
        ...pick(zoomResponse, 'code', 'subCode', 'message'),
        ...customResponse,
        isVerified: false
      }

      throw exception
    }

    // 1. checking for duplicates
    // we don't need to catch specific cases so
    // we don't wrapping call to try catch
    // any unexpected errors will be automatically rethrown
    const { defaultMinimalMatchLevel } = api
    const { results, response } = await api.faceSearch(payload, defaultMinimalMatchLevel, customLogger)
    // excluding own enrollmentIdentifier
    let duplicate = results.find(
      ({ enrollmentIdentifier: matchId }) => matchId.toLowerCase() !== enrollmentIdentifier.toLowerCase()
    )
    // if there're at least one record left - we have a duplicate
    const isDuplicate = !!duplicate

    // notifying about duplicates found or not
    await notifyProcessor({ isDuplicate })

    if (isDuplicate) {
      const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`

      // if duplicate found - throwing corresponding error
      duplicate = omit(duplicate, 'auditTrailImage')
      log.warn(duplicateFoundMessage, { duplicate, enrollmentIdentifier })

      throwCustomException(duplicateFoundMessage, { isDuplicate }, response)
    }

    let enrollmentStatus
    let alreadyEnrolled = false

    // 2. performing enroll
    try {
      // returning last respose
      const { message } = await api.submitEnrollment({ ...payload, enrollmentIdentifier }, customLogger)

      enrollmentStatus = message
    } catch (exception) {
      const { response, message } = exception

      // if exception has no response (e.g. no conneciton or service error)
      // just rethrowing it and stopping enrollment
      if (!response) {
        throw exception
      }

      // if exception has response checking
      // is subCode non-equals to 'nameCollision'
      // that we have some enrollment error
      // (e.g. liveness wasn't passsed, glasses detected, poor quality)
      if ('nameCollision' !== response.subCode) {
        const isEnrolled = false
        const isLive = api.checkLivenessStatus(response)

        // then notifying & throwing enrollment exception
        await notifyProcessor({ isEnrolled, isLive })
        throwCustomException(message, { isEnrolled, isLive }, response)
      }

      // otherwise, if subCode equals to 'nameCollision'
      // that means identifier was already enrolled
      // as we've already passed dupliucate check
      // we don't throw anything, but setting alreadyEnrolled flag
      alreadyEnrolled = true

      // returning 'already enrolled' status
      enrollmentStatus = 'The FaceMap was already enrolled.'
    }

    // notifying about successfull enrollment
    await notifyProcessor({ isEnrolled: true, isLive: true })
    // returning successfull result
    return { isVerified: true, alreadyEnrolled, message: enrollmentStatus }
  }

  async enrollmentExists(enrollmentIdentifier: string, customLogger = null): Promise<boolean> {
    const { api, logger } = this
    const log = customLogger || logger

    try {
      await api.readEnrollment(enrollmentIdentifier, customLogger)
    } catch (exception) {
      const { response, message: errMessage } = exception
      const { subCode } = response || {}

      if ('facemapNotFound' === subCode) {
        log.warn('Enrollment not exists', { enrollmentIdentifier })
        return false
      }

      log.warn('Error checking enrollment', { e: exception, errMessage, enrollmentIdentifier })
      throw exception
    }

    return true
  }

  async dispose(enrollmentIdentifier: string, customLogger = null): Promise<void> {
    const { api, logger } = this
    const log = customLogger || logger

    try {
      await api.disposeEnrollment(enrollmentIdentifier, customLogger)
    } catch (exception) {
      const { response, message: errMessage } = exception
      const { subCode } = response || {}

      if ('facemapNotFound' === subCode) {
        log.warn('Enrollment not exists', { enrollmentIdentifier })
        return
      }

      log.warn('Error disposing enrollment', { e: exception, errMessage, enrollmentIdentifier })
      throw exception
    }
  }
}

export default new ZoomProvider(ZoomAPI, logger.child({ from: 'ZoomProvider' }))

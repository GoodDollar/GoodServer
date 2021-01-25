// @flow
import { omit, once, omitBy, bindAll } from 'lodash'

import initZoomAPI from '../../api/ZoomAPI'
import {
  faceSnapshotFields,
  ZoomAPIError,
  duplicateFoundMessage,
  successfullyEnrolledMessage,
  alreadyEnrolledMessage
} from '../../constants'
import logger from '../../../../imports/logger'

import { type IEnrollmentProvider } from '../typings'

class ZoomProvider implements IEnrollmentProvider {
  api = null
  logger = null

  constructor(api, logger) {
    this.api = api
    this.logger = logger

    bindAll(this, ['_handleNotExistsException', '_isNotExistsException'])
  }

  isPayloadValid(payload: any): boolean {
    return !faceSnapshotFields.some(field => !payload[field])
  }

  async issueToken(customLogger = null): Promise<string> {
    const { sessionToken } = await this.api.getSessionToken(customLogger)

    return sessionToken
  }

  async enroll(
    enrollmentIdentifier: string,
    payload: any,
    onEnrollmentProcessing: (payload: IEnrollmentEventPayload) => void | Promise<void>,
    customLogger = null
  ): Promise<any> {
    const { api, logger } = this
    const log = customLogger || logger
    const { defaultMinimalMatchLevel, defaultSearchIndexName } = api
    const { LivenessCheckFailed, SecurityCheckFailed, FacemapNotFound, FacemapDoesNotMatch } = ZoomAPIError

    // send event to onEnrollmentProcessing
    const notifyProcessor = async eventPayload => onEnrollmentProcessing(eventPayload)

    // throws custom exception related to the predefined verification cases
    // e.g. livenes wasn't passed, duplicate found etc
    const throwCustomException = (customMessage, customResponse, zoomResponse = {}) => {
      const exception = new Error(customMessage)
      // removing debug fields
      let redactedResponse = omit(zoomResponse, 'callData', 'additionalSessionData', 'serverInfo')

      // removing all large data (e.g. images , facemaps)
      redactedResponse = omitBy(redactedResponse, (_, field) => field.endsWith('Base64'))

      exception.response = {
        ...redactedResponse,
        ...customResponse,
        isVerified: false
      }

      throw exception
    }

    // 1. checking if facescan already uploaded & enrolled
    let alreadyEnrolled

    try {
      await api.readEnrollment(enrollmentIdentifier, customLogger)
      alreadyEnrolled = true
    } catch (exception) {
      // if something other that 'FacemapNotFound was thrown - re-throwing
      if (FacemapNotFound !== exception.name) {
        throw exception
      }

      // otherwise, setting alreadyEnrolled to false
      alreadyEnrolled = false
    }

    // 2. performing liveness check and storing facescan / audit trail images (if need)
    let isLive = true
    let isNotMatch = false

    try {
      // if already enrolled, will call /match-3d
      // othwerise (if not enrolled/stored yet) - /enroll
      const methodToInvoke = (alreadyEnrolled ? 'update' : 'submit') + 'Enrollment'

      await api[methodToInvoke](enrollmentIdentifier, payload, customLogger)
    } catch (exception) {
      const { name, message, response } = exception

      // if facemap doesn't match we won't show retry screen
      if (FacemapDoesNotMatch === name) {
        isNotMatch = true

        await notifyProcessor({ isNotMatch })
        log.warn(message, { enrollmentIdentifier })

        // so we'll reject with isNotMatch: true instead
        // to show the error screen on app side immediately
        // notifying about liveness check failed
        throwCustomException(message, { isNotMatch }, response)
      }

      // if liveness / security issues were detected
      if ([LivenessCheckFailed, SecurityCheckFailed].includes(name)) {
        isLive = false

        // notifying about liveness check failed
        await notifyProcessor({ isLive })
        log.warn(message, { enrollmentIdentifier })
        throwCustomException(message, { isLive }, response)
      }

      // otherwise just re-throwing exception and stopping processing
      throw exception
    }

    // notifying about liveness / match passed or not
    await notifyProcessor({ isLive, isNotMatch })

    // 3. checking for duplicates
    const { results, ...faceSearchResponse } = await api.faceSearch(
      enrollmentIdentifier,
      defaultMinimalMatchLevel,
      defaultSearchIndexName,
      customLogger
    )

    // excluding own enrollmentIdentifier
    const duplicate = results.find(
      ({ identifier: matchId }) => matchId.toLowerCase() !== enrollmentIdentifier.toLowerCase()
    )

    // if there're at least one record left - we have a duplicate
    const isDuplicate = !!duplicate

    // notifying about duplicates found or not
    await notifyProcessor({ isDuplicate })

    if (isDuplicate) {
      // if duplicate found - throwing corresponding error
      log.warn(duplicateFoundMessage, { duplicate, enrollmentIdentifier })
      throwCustomException(duplicateFoundMessage, { isDuplicate }, faceSearchResponse)
    }

    // 4. if not alreadyEnrolled - indexing uploaded & stored face scan to the 3D Database
    let isEnrolled = true

    if (!alreadyEnrolled) {
      try {
        await api.indexEnrollment(enrollmentIdentifier, defaultSearchIndexName, customLogger)
      } catch (exception) {
        const { response, message } = exception

        // if exception has no response (e.g. no conneciton or service error)
        // just rethrowing it and stopping enrollment
        if (!response) {
          throw exception
        }

        // otherwise notifying & throwing enrollment exception
        isEnrolled = false

        await notifyProcessor({ isEnrolled })
        throwCustomException(message, { isEnrolled }, response)
      }
    }

    // preparing corresponding success message depinding of the alreadyEnrolled status
    const enrollmentStatus = alreadyEnrolled ? alreadyEnrolledMessage : successfullyEnrolledMessage

    // notifying about successfull enrollment
    await notifyProcessor({ isEnrolled })

    // returning successfull result
    return { isVerified: true, alreadyEnrolled, message: enrollmentStatus }
  }

  async isEnrollmentIndexed(enrollmentIdentifier: string, customLogger = null): Promise<boolean> {
    const { api, logger, _isNotExistsException } = this
    const log = customLogger || logger
    const { defaultSearchIndexName } = api

    try {
      await api.readEnrollmentIndex(enrollmentIdentifier, defaultSearchIndexName, customLogger)
    } catch (exception) {
      const { message: errMessage } = exception

      if (_isNotExistsException(enrollmentIdentifier, exception, customLogger)) {
        return false
      }

      log.warn('Error checking enrollment', { e: exception, errMessage, enrollmentIdentifier })
      throw exception
    }

    return true
  }

  async dispose(enrollmentIdentifier: string, customLogger = null): Promise<void> {
    const { api, _handleNotExistsException, logger } = this
    const { defaultSearchIndexName } = api
    const log = customLogger || logger

    // eslint-disable-next-line require-await
    await _handleNotExistsException(enrollmentIdentifier, customLogger, async () =>
      api.removeEnrollmentFromIndex(enrollmentIdentifier, defaultSearchIndexName, customLogger)
    )

    // trying to remove also facemap from the DB
    try {
      // eslint-disable-next-line require-await
      await _handleNotExistsException(enrollmentIdentifier, customLogger, async () =>
        api.disposeEnrollment(enrollmentIdentifier, customLogger)
      )
    } catch (exception) {
      const { message: errMessage } = exception

      // if delete enrollment isn't supported by the server it will try to enroll
      // it check is enrollment already exists then validates input payload
      // so one of 'already exists' or 'facescan not valid' will be thrown
      if (/(enrollment\s+already\s+exists|faceScan\s+.+?not\s+valid)/i.test(errMessage)) {
        log.warn("ZoOm server doesn't supports removing enrollments", { enrollmentIdentifier })
      }
    }
  }

  async _handleNotExistsException(enrollmentIdentifier, customLogger = null, operation): Promise<void> {
    const { _isNotExistsException, logger } = this
    const log = customLogger || logger

    try {
      await operation()
    } catch (exception) {
      const { message: errMessage } = exception

      if (_isNotExistsException(enrollmentIdentifier, exception, customLogger)) {
        return
      }

      log.warn('Error disposing enrollment', { e: exception, errMessage, enrollmentIdentifier })
      throw exception
    }
  }

  _isNotExistsException(enrollmentIdentifier, exception, customLogger) {
    const log = customLogger || this.logger
    const isNotIndexed = ZoomAPIError.FacemapNotFound === exception.name

    if (isNotIndexed) {
      log.warn("Enrollment isn't indexed in the 3D Database", { enrollmentIdentifier })
    }

    return isNotIndexed
  }
}

export default once(() => new ZoomProvider(initZoomAPI(), logger.child({ from: 'ZoomProvider' })))

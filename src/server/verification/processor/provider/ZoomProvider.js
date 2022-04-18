// @flow
import { get, once, omitBy, bindAll, values, isError } from 'lodash'

import initZoomAPI from '../../api/ZoomAPI'

import {
  ZoomAPIError,
  duplicateFoundMessage,
  successfullyEnrolledMessage,
  alreadyEnrolledMessage,
  ZoomLicenseType
} from '../../utils/constants'

import { faceSnapshotFields } from '../../utils/logger'
import logger from '../../../../imports/logger'

import { type IEnrollmentProvider } from '../typings'

class ZoomProvider implements IEnrollmentProvider {
  api = null
  logger = null

  constructor(api, logger) {
    this.api = api
    this.logger = logger

    bindAll(this, ['_enrollmentOperation'])
  }

  isPayloadValid(payload: any): boolean {
    return !faceSnapshotFields.some(field => !payload[field])
  }

  isValidLicenseType(licenseType: string): boolean {
    return values(ZoomLicenseType).includes(licenseType)
  }

  async getLicenseKey(licenseType, customLogger = null): Promise<any> {
    const { api } = this
    const { key } = await api.getLicenseKey(licenseType, customLogger)

    return key
  }

  async issueToken(customLogger = null): Promise<string> {
    const { api } = this
    const { sessionToken } = await api.getSessionToken(customLogger)

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
    const { LivenessCheckFailed, SecurityCheckFailed, FacemapDoesNotMatch } = ZoomAPIError

    // send event to onEnrollmentProcessing
    const notifyProcessor = async eventPayload => onEnrollmentProcessing(eventPayload)
    const isLargeTextField = field => ['Base64', 'Blob'].some(suffix => field.endsWith(suffix))
    const redactedFields = ['callData', 'additionalSessionData', 'serverInfo']

    // throws custom exception related to the predefined verification cases
    // e.g. livenes wasn't passed, duplicate found etc
    const throwException = (errorOrMessage, customResponse, originalResponse = {}) => {
      let exception = errorOrMessage
      let { response } = exception || {}

      if (!isError(errorOrMessage)) {
        exception = new Error(errorOrMessage)
        response = originalResponse
      }

      // removing debug fields and all large data (e.g.
      // images, facemaps), keeping just 'scanResultBlob'
      const redactedResponse = omitBy(response, (_, field) => redactedFields.includes(field) || isLargeTextField(field))

      exception.response = {
        ...redactedResponse,
        ...customResponse,
        isVerified: false
      }

      throw exception
    }

    // 1. checking if facescan already uploaded & enrolled
    // refactored - using a separate method was added after initial implementation
    // instead of the direct API call
    const alreadyEnrolled = await this.isEnrollmentExists(enrollmentIdentifier, customLogger)

    // 2. performing liveness check and storing facescan / audit trail images (if need)
    let resultBlob
    let isLive = true
    let isNotMatch = false

    try {
      // if already enrolled, will call /match-3d
      // othwerise (if not enrolled/stored yet) - /enroll
      const methodToInvoke = (alreadyEnrolled ? 'update' : 'submit') + 'Enrollment'
      const response = await api[methodToInvoke](enrollmentIdentifier, payload, customLogger)

      resultBlob = get(response, 'scanResultBlob')
      log.debug('Received enrollment:', { enrollmentIdentifier, alreadyEnrolled })
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
        throwException(message, { isNotMatch }, response)
      }

      resultBlob = get(response, 'scanResultBlob')

      // if liveness / security issues were detected
      if ([LivenessCheckFailed, SecurityCheckFailed].includes(name)) {
        isLive = false

        // notifying about liveness check failed
        await notifyProcessor({ isLive })
        log.warn(message, { enrollmentIdentifier })
        throwException(message, { isLive, resultBlob }, response)
      }

      // if had response - re-throw with scanResultBlob
      if (response) {
        throwException(exception, { resultBlob })
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
      throwException(duplicateFoundMessage, { isDuplicate }, faceSearchResponse)
    }

    // 4. indexing uploaded & stored face scan to the 3D Database
    let isEnrolled = true
    // if wasn't already enrolled -  this means it wasn't also indexed
    let alreadyIndexed = false

    if (alreadyEnrolled) {
      // if already enrolled - need to check was it already indexed or not
      alreadyIndexed = await this.isEnrollmentIndexed(enrollmentIdentifier, customLogger)
    }

    log.debug('Preparing enrollment to index:', { enrollmentIdentifier, alreadyEnrolled, alreadyIndexed })

    if (alreadyIndexed) {
      log.debug('Enrollment already indexed, skipping:', { enrollmentIdentifier })
    } else {
      // if not already enrolled or indexed - indexing
      try {
        await api.indexEnrollment(enrollmentIdentifier, defaultSearchIndexName, customLogger)
        log.debug('Enrollment indexed:', { enrollmentIdentifier })
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
        throwException(message, { isEnrolled }, response)
      }
    }

    // preparing corresponding success message depinding of the alreadyEnrolled status
    const enrollmentStatus = alreadyEnrolled ? alreadyEnrolledMessage : successfullyEnrolledMessage

    // notifying about successfull enrollment
    await notifyProcessor({ isEnrolled })

    // returning successfull result
    return { isVerified: true, alreadyEnrolled, resultBlob, message: enrollmentStatus }
  }

  // eslint-disable-next-line require-await
  async isEnrollmentExists(enrollmentIdentifier: string, customLogger = null): Promise<boolean> {
    return this._enrollmentOperation('Error checking enrollment', enrollmentIdentifier, customLogger, async () =>
      this.api.readEnrollment(enrollmentIdentifier, customLogger)
    )
  }

  // eslint-disable-next-line require-await
  async isEnrollmentIndexed(enrollmentIdentifier: string, customLogger = null): Promise<boolean> {
    const { api } = this

    return this._enrollmentOperation('Error checking enrollment', enrollmentIdentifier, customLogger, async () =>
      api.readEnrollmentIndex(enrollmentIdentifier, api.defaultSearchIndexName, customLogger)
    )
  }

  async dispose(enrollmentIdentifier: string, customLogger = null): Promise<void> {
    const { api, _enrollmentOperation, logger } = this
    const { defaultSearchIndexName } = api
    const log = customLogger || logger
    const logLabel = 'Error disposing enrollment'

    // eslint-disable-next-line require-await
    await _enrollmentOperation(logLabel, enrollmentIdentifier, customLogger, async () => {
      await api.removeEnrollmentFromIndex(enrollmentIdentifier, defaultSearchIndexName, customLogger)
      log.debug('Enrollment removed from the search index', { enrollmentIdentifier })
    })

    // trying to remove also facemap from the DB
    try {
      // eslint-disable-next-line require-await
      await _enrollmentOperation(logLabel, enrollmentIdentifier, customLogger, async () => {
        await api.disposeEnrollment(enrollmentIdentifier, customLogger)
        log.debug('Enrollment removed physically from the DB', { enrollmentIdentifier })
      })
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

  async _enrollmentOperation(logLabel, enrollmentIdentifier, customLogger = null, operation): Promise<boolean> {
    const log = customLogger || this.logger

    try {
      await operation()
      return true
    } catch (exception) {
      const { message: errMessage } = exception

      if (ZoomAPIError.FacemapNotFound === exception.name) {
        return false
      }

      log.warn(logLabel, { e: exception, errMessage, enrollmentIdentifier })
      throw exception
    }
  }
}

export default once(() => new ZoomProvider(initZoomAPI(), logger.child({ from: 'ZoomProvider' })))

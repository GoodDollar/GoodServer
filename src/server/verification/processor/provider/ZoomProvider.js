// @flow
import { omit, once, omitBy, assign, slice, bindAll } from 'lodash'

import initZoomAPI, { faceSnapshotFields, ZoomAPIError, ZoomAPIFeature } from '../../api/ZoomAPI.js'
import logger from '../../../../imports/logger'

import { type IEnrollmentProvider } from '../typings'

export const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`
export const successfullyEnrolledMessage = 'The FaceMap was successfully enrolled.'
export const alreadyEnrolledMessage = 'The FaceMap was already enrolled.'

class ZoomProvider implements IEnrollmentProvider {
  api = null
  logger = null
  _apiFeatures = null

  constructor(api, logger) {
    this.api = api
    this.logger = logger

    bindAll(this, ['_supportsFeature', '_handleNotExistsException', '_isNotExistsException'])
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
    const { api, logger, _supportsFeature } = this
    const log = customLogger || logger
    const { defaultMinimalMatchLevel, defaultSearchIndexName } = api
    const { LivenessCheckFailed, SecurityCheckFailed, FacemapNotFound } = ZoomAPIError

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

    let alreadyEnrolled
    // checking is API supports delete enrollment endpoint
    const isDisposeSupported = await _supportsFeature(ZoomAPIFeature.DisposeEnrollment)

    // 1. checking if facescan already uploaded & enrolled
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

    try {
      const callArgs = [enrollmentIdentifier, payload, customLogger]
      const enroll = () => api.submitEnrollment(...callArgs)

      // if already enrolled, will call checkLiveness
      // this is need because enroll doesn't re-checks facemap/images
      // for liveness if identifier already enrolled
      if (alreadyEnrolled) {
        // it doesn't need enrollmentIdentifier param,
        // so we're slicing it from the start of the args
        await api.checkLiveness(...slice(callArgs, 1))

        // if api supports delete enrollment endpoint
        if (isDisposeSupported) {
          // then we're refreshing enrolled facemap with the data just received
          // firstly, removing snapshot enrolled before
          await this.dispose(enrollmentIdentifier)
          // then enrolling it with the new data already verified for liveness
          await enroll()
          // setting enrolled flag to false as we re-enrolled the facemap
          alreadyEnrolled = false
        }
      } else {
        // if not enrolled/stored yet - just calling enroll.
        await enroll()
      }
    } catch (exception) {
      const { name, message, response } = exception

      // if liveness / security issues were detected
      if ([LivenessCheckFailed, SecurityCheckFailed].includes(name)) {
        isLive = false

        // notifying about liveness check failed
        await notifyProcessor({ isLive })
        log.warn(message, { enrollmentIdentifier })
        throwCustomException(message, { isLive }, response)
      }

      // otherwisw just re-throwing exception and stopping processing
      throw exception
    }

    // notifying about liveness passed or not
    await notifyProcessor({ isLive })

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

    // 4. enrolling and indexing uploaded & stored face scan to the 3D Database
    let isEnrolled = true

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
    const { api, _handleNotExistsException, _supportsFeature } = this
    const { defaultSearchIndexName } = api
    // checking is API supports delete enrollment endpoint
    const isDisposeSupported = await _supportsFeature(ZoomAPIFeature.DisposeEnrollment)

    // eslint-disable-next-line require-await
    await _handleNotExistsException(enrollmentIdentifier, customLogger, async () =>
      api.removeEnrollmentFromIndex(enrollmentIdentifier, defaultSearchIndexName, customLogger)
    )

    // if delete enrollment supported, removig also facemap from the DB
    if (isDisposeSupported) {
      // eslint-disable-next-line require-await
      await _handleNotExistsException(enrollmentIdentifier, customLogger, async () =>
        api.disposeEnrollment(enrollmentIdentifier, customLogger)
      )
    }
  }

  async _supportsFeature(feature: string): Promise<boolean> {
    let { _apiFeatures, api } = this

    if (!_apiFeatures) {
      _apiFeatures = await api.getAPIFeatures()
      assign(this, { _apiFeatures })
    }

    return _apiFeatures.includes(feature)
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

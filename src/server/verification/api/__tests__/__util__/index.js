import { isArray, upperFirst } from 'lodash'

import {
  failedLivenessMessage,
  failedEnrollmentMessage,
  enrollmentNotFoundMessage,
  enrollmentAlreadyExistsMessage,
  ZoomAPIFeature
} from '../../ZoomAPI'

import {
  duplicateFoundMessage,
  alreadyEnrolledMessage,
  successfullyEnrolledMessage
} from '../../../processor/provider/ZoomProvider'

export default zoomServiceMock => {
  const serviceErrorMessage = 'Request failed with status code 500'
  const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'
  const dbInternalEnrollmentAlreadyExists = `An enrollment already exists for this externalDatabaseRefID.`
  const dbInternalEnrollmentDoesntExists = 'An enrollment does not exist for this externalDatabaseRefID.'
  const searchIndexNotInitializedMessage = 'Tried to search a groupName when that groupName does not exist.'

  const enrollmentUri = enrollmentIdentifier => `/enrollment-3d/${encodeURIComponent(enrollmentIdentifier)}`

  const enrollmentPayloadMatcher = enrollmentIdentifier => ({
    asymmetricMatch(payload) {
      const { externalDatabaseRefID, identifier } = payload || {}

      return [externalDatabaseRefID, identifier].some(id => id === enrollmentIdentifier)
    }
  })

  const successResponse = { success: true, error: false }

  const mockErrorResponse = message => ({
    error: true,
    errorMessage: message,
    success: false
  })

  const statusResponse = (withFeatures = null) => {
    const response = {
      ...successResponse,
      running: true
    }

    if (isArray(withFeatures)) {
      response.extra = withFeatures
    }

    zoomServiceMock.onGet('/status').reply(200, response)
  }

  const notFoundResponse = (enrollmentIdentifier, operation) =>
    zoomServiceMock['on' + upperFirst(operation)](enrollmentUri(enrollmentIdentifier)).reply(
      200,
      mockErrorResponse('No entry found in the database for this externalDatabaseRefID.')
    )

  const faceScanResponse = (operation, payloadOrMatcher = null, response = {}, reasonFlags = {}) => {
    const mockArgs = [`/${operation}-3d`]

    if (payloadOrMatcher) {
      mockArgs.push(payloadOrMatcher)
    }

    zoomServiceMock.onPost(...mockArgs).reply(200, {
      faceScanSecurityChecks: {
        replayCheckSucceeded: true,
        sessionTokenCheckSucceeded: true,
        auditTrailVerificationCheckSucceeded: true,
        faceScanLivenessCheckSucceeded: true,
        ...reasonFlags
      },
      ...successResponse,
      ...response
    })
  }

  const dbSuccessResponse = (operation, enrollmentIdentifier, response = {}) =>
    zoomServiceMock.onPost(`/3d-db/${operation}`, enrollmentPayloadMatcher(enrollmentIdentifier)).reply(200, {
      ...successResponse,
      ...response
    })

  const dbFailedResponse = (operation, enrollmentIdentifier, message = null) => {
    const mockedResponse = message ? mockErrorResponse(message) : { success: false, error: false }

    zoomServiceMock
      .onPost(`/3d-db/${operation}`, enrollmentPayloadMatcher(enrollmentIdentifier))
      .reply(200, mockedResponse)
  }

  const mockServerRunning = () => statusResponse()

  const mockServerSupportsDeleteEnrollment = () => statusResponse([ZoomAPIFeature.DisposeEnrollment])

  const mockSuccessSessionToken = sessionToken =>
    zoomServiceMock.onGet('/session-token').reply(200, {
      sessionToken,
      ...successResponse
    })

  const mockFailedSessionToken = (withMessage = null) =>
    zoomServiceMock.onGet('/session-token').reply(403, mockErrorResponse(withMessage))

  const mockEnrollmentFound = enrollmentIdentifier =>
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(200, {
      externalDatabaseRefID: enrollmentIdentifier,
      faceMapBase64: Buffer.alloc(32).toString(),
      auditTrailBase64: 'data:image/png:FaKEimagE==',
      ...successResponse
    })

  const mockEnrollmentNotFound = enrollmentIdentifier => notFoundResponse(enrollmentIdentifier, 'get')

  const mockSuccessRemoveEnrollment = enrollmentIdentifier =>
    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(200, successResponse)

  const mockEnrollmentNotExistsDuringRemove = enrollmentIdentifier => notFoundResponse(enrollmentIdentifier, 'delete')

  const mockNoRecorsFoundDuringRemoveEnrollment = enrollmentIdentifier =>
    zoomServiceMock
      .onDelete(enrollmentUri(enrollmentIdentifier))
      .reply(200, mockErrorResponse('No records were deleted for the externalDatabaseRefID'))

  const mockSuccessLivenessCheck = () => faceScanResponse('liveness')

  const mockFailedLivenessCheck = (withReasonFlags = {}) => {
    const reasonFlags = {
      faceScanLivenessCheckSucceeded: false,
      ...withReasonFlags
    }

    faceScanResponse('liveness', null, { success: false }, reasonFlags)
  }

  const mockSuccessIndexEnrollment = enrollmentIdentifier => dbSuccessResponse('enroll', enrollmentIdentifier)

  const mockFailedIndexEnrollment = (enrollmentIdentifier, message) =>
    dbFailedResponse('enroll', enrollmentIdentifier, message)

  const mockEnrollmentNotExistsDuringIndex = enrollmentIdentifier =>
    dbFailedResponse('enroll', enrollmentIdentifier, dbInternalEnrollmentDoesntExists)

  const mockSuccessReadEnrollmentIndex = enrollmentIdentifier => dbSuccessResponse('get', enrollmentIdentifier)

  const mockFailedReadEnrollmentIndex = (enrollmentIdentifier, message) =>
    dbFailedResponse('get', enrollmentIdentifier, message)

  // 3d-db/get doesn't returns 'An enrollment does not exist' just success: false
  const mockEnrollmentNotExistsDuringReadIndex = enrollmentIdentifier => dbFailedResponse('get', enrollmentIdentifier)

  const mockSuccessRemoveEnrollmentFromIndex = enrollmentIdentifier => dbSuccessResponse('delete', enrollmentIdentifier)

  const mockFailedRemoveEnrollmentFromIndex = (enrollmentIdentifier, message) =>
    dbFailedResponse('delete', enrollmentIdentifier, message)

  // 3d-db/delete doesn't returns 'An enrollment does not exist' just success: false
  const mockEnrollmentNotExistsDuringRemoveFromIndex = enrollmentIdentifier =>
    dbFailedResponse('delete', enrollmentIdentifier)

  const mockServiceErrorDuringRemoveFromIndex = enrollmentIdentifier =>
    zoomServiceMock.onPost('/3d-db/delete', enrollmentPayloadMatcher(enrollmentIdentifier)).reply(500)

  const mockEmptyResultsFaceSearch = enrollmentIdentifier =>
    dbSuccessResponse('search', enrollmentIdentifier, { results: [] })

  const mockDuplicateFound = enrollmentIdentifier =>
    dbSuccessResponse('search', enrollmentIdentifier, {
      results: [
        {
          identifier: duplicateEnrollmentIdentifier,
          matchLevel: 10
        }
      ]
    })

  const mockFailedSearch = (enrollmentIdentifier, message) => dbFailedResponse('search', enrollmentIdentifier, message)

  const mockSearchIndexNotInitialized = enrollmentIdentifier =>
    mockFailedSearch(enrollmentIdentifier, searchIndexNotInitializedMessage)

  const mockEnrollmentNotExistsDuringSearch = enrollmentIdentifier =>
    dbFailedResponse('search', enrollmentIdentifier, dbInternalEnrollmentDoesntExists)

  const mockSuccessEnrollment = enrollmentIdentifier =>
    faceScanResponse('enrollment', enrollmentPayloadMatcher(enrollmentIdentifier), {
      externalDatabaseRefID: enrollmentIdentifier
    })

  const mockFailedEnrollment = (enrollmentIdentifier, withReasonFlags = {}) => {
    const payloadMatcher = enrollmentPayloadMatcher(enrollmentIdentifier)

    const reasonFlags = {
      faceScanLivenessCheckSucceeded: false,
      ...withReasonFlags
    }

    const response = {
      externalDatabaseRefID: enrollmentIdentifier,
      success: false
    }

    faceScanResponse('enrollment', payloadMatcher, response, reasonFlags)
  }

  const mockEnrollmentAlreadyExists = enrollmentIdentifier =>
    zoomServiceMock
      .onPost('/enrollment-3d', enrollmentPayloadMatcher(enrollmentIdentifier))
      .reply(200, mockErrorResponse(dbInternalEnrollmentAlreadyExists))

  const mock3dDatabaseEnrollmentSuccess = mockSuccessIndexEnrollment

  const mock3dDatabaseEnrollmentFailed = enrollmentIdentifier =>
    mockFailedIndexEnrollment(enrollmentIdentifier, failedEnrollmentMessage)

  return {
    enrollmentUri,
    enrollmentPayloadMatcher,
    mockErrorResponse,
    serviceErrorMessage,

    mockServerRunning,
    mockServerSupportsDeleteEnrollment,

    mockSuccessSessionToken,
    mockFailedSessionToken,

    enrollmentNotFoundMessage,
    mockEnrollmentFound,
    mockEnrollmentNotFound,

    mockSuccessRemoveEnrollment,
    mockEnrollmentNotExistsDuringRemove,
    mockNoRecorsFoundDuringRemoveEnrollment,

    failedLivenessMessage,
    mockSuccessLivenessCheck,
    mockFailedLivenessCheck,

    mockSuccessIndexEnrollment,
    mockFailedIndexEnrollment,
    mockEnrollmentNotExistsDuringIndex,

    mockSuccessReadEnrollmentIndex,
    mockFailedReadEnrollmentIndex,
    mockEnrollmentNotExistsDuringReadIndex,

    mockSuccessRemoveEnrollmentFromIndex,
    mockFailedRemoveEnrollmentFromIndex,
    mockEnrollmentNotExistsDuringRemoveFromIndex,
    mockServiceErrorDuringRemoveFromIndex,

    duplicateEnrollmentIdentifier,
    duplicateFoundMessage,
    searchIndexNotInitializedMessage,
    mockEmptyResultsFaceSearch,
    mockDuplicateFound,
    mockFailedSearch,
    mockEnrollmentNotExistsDuringSearch,
    mockSearchIndexNotInitialized,

    alreadyEnrolledMessage,
    successfullyEnrolledMessage,
    failedEnrollmentMessage,
    enrollmentAlreadyExistsMessage,
    mockSuccessEnrollment,
    mockFailedEnrollment,
    mockEnrollmentAlreadyExists,

    mock3dDatabaseEnrollmentSuccess,
    mock3dDatabaseEnrollmentFailed
  }
}

import { upperFirst, toLower, assign, isPlainObject } from 'lodash'

import { enrollmentIdFields } from '../../../utils/logger'

import {
  failedLivenessMessage,
  failedEnrollmentMessage,
  failedMatchMessage,
  enrollmentNotFoundMessage,
  enrollmentAlreadyExistsMessage,
  duplicateFoundMessage,
  alreadyEnrolledMessage,
  successfullyEnrolledMessage
} from '../../../utils/constants'

export default zoomServiceMock => {
  const serviceErrorMessage = 'Request failed with status code 500'
  const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'
  const dbInternalEnrollmentAlreadyExists = `An enrollment already exists for this externalDatabaseRefID.`
  const dbInternalEnrollmentDoesntExists = 'An enrollment does not exist for this externalDatabaseRefID.'
  const searchIndexNotInitializedMessage = 'Tried to search a groupName when that groupName does not exist.'

  const enrollmentUri = enrollmentIdentifier => `/enrollment-3d/${encodeURIComponent(toLower(enrollmentIdentifier))}`

  const licenseUri = licenseType => `/license/${encodeURIComponent(licenseType)}`

  const enrollmentPayloadMatcher = enrollmentIdentifier => {
    const enrollmentId = toLower(enrollmentIdentifier)

    return {
      asymmetricMatch(payload) {
        return enrollmentIdFields.some(field => payload[field] === enrollmentId)
      }
    }
  }

  const successResponse = { success: true, error: false }

  const mockErrorResponse = message => ({
    error: true,
    errorMessage: message,
    success: false
  })

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

  const mockSuccessLicenseKey = (licenseType, key) =>
    zoomServiceMock.onGet(licenseUri(licenseType)).reply(200, {
      key,
      ...successResponse
    })

  const mockFailedLicenseKey = (licenseType, withMessage = null) =>
    zoomServiceMock.onGet(licenseUri(licenseType)).reply(403, mockErrorResponse(withMessage))

  const mockSuccessSessionToken = sessionToken =>
    zoomServiceMock.onGet('/session-token').reply(200, {
      sessionToken,
      ...successResponse
    })

  const mockFailedSessionToken = (withMessage = null) =>
    zoomServiceMock.onGet('/session-token').reply(403, mockErrorResponse(withMessage))

  const mockEnrollmentFound = (enrollmentIdentifier, customEnrollmentData = {}) =>
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(200, {
      faceMapBase64: Buffer.alloc(32).toString(),
      auditTrailBase64: 'data:image/png:FaKEimagE==',
      ...customEnrollmentData,
      externalDatabaseRefID: enrollmentIdentifier,
      ...successResponse
    })

  const mockEnrollmentNotFound = enrollmentIdentifier => notFoundResponse(enrollmentIdentifier, 'get')

  const mockSuccessRemoveEnrollment = enrollmentIdentifier =>
    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(200, successResponse)

  const mockEnrollmentNotExistsDuringRemove = enrollmentIdentifier => notFoundResponse(enrollmentIdentifier, 'delete')

  const mockRemoveEnrollmentNotSupported = enrollmentIdentifier =>
    zoomServiceMock
      .onDelete(enrollmentUri(enrollmentIdentifier))
      .reply(200, mockErrorResponse(dbInternalEnrollmentAlreadyExists))

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

  const mockSuccessEnrollment = (enrollmentIdentifier, scanResultBlob = null) => {
    const payload = { externalDatabaseRefID: enrollmentIdentifier }

    if (scanResultBlob) {
      assign(payload, { scanResultBlob })
    }

    faceScanResponse('enrollment', enrollmentPayloadMatcher(enrollmentIdentifier), payload)
  }

  const mockSuccessEnrollmentUnderAge = enrollmentIdentifier => {
    const payload = { externalDatabaseRefID: enrollmentIdentifier, ageV2GroupEnumInt: 2 }

    faceScanResponse('enrollment', enrollmentPayloadMatcher(enrollmentIdentifier), payload)
  }

  const mockFailedEnrollment = (enrollmentIdentifier, withReasonFlags = {}, resultBlob = null) => {
    const payloadMatcher = enrollmentPayloadMatcher(enrollmentIdentifier)
    let reasonFlags = withReasonFlags
    let scanResultBlob = resultBlob

    if (!isPlainObject(withReasonFlags)) {
      reasonFlags = {}
      scanResultBlob = withReasonFlags
    }

    const flags = {
      faceScanLivenessCheckSucceeded: false,
      ...reasonFlags
    }

    const response = {
      externalDatabaseRefID: enrollmentIdentifier,
      success: false
    }

    if (scanResultBlob) {
      assign(response, { scanResultBlob })
    }

    faceScanResponse('enrollment', payloadMatcher, response, flags)
  }

  const mockEnrollmentAlreadyExists = enrollmentIdentifier =>
    zoomServiceMock
      .onPost('/enrollment-3d', enrollmentPayloadMatcher(enrollmentIdentifier))
      .reply(200, mockErrorResponse(dbInternalEnrollmentAlreadyExists))

  const mockSuccessUpdateEnrollment = enrollmentIdentifier =>
    faceScanResponse('match-3d', enrollmentPayloadMatcher(enrollmentIdentifier), {
      externalDatabaseRefID: enrollmentIdentifier,
      matchLevel: 10
    })

  const mockFailedUpdateEnrollment = (enrollmentIdentifier, faceMapDoesntMatch = false, withReasonFlags = {}) => {
    const payloadMatcher = enrollmentPayloadMatcher(enrollmentIdentifier)

    const reasonFlags = {
      faceScanLivenessCheckSucceeded: !!faceMapDoesntMatch,
      ...withReasonFlags
    }

    const response = {
      externalDatabaseRefID: enrollmentIdentifier,
      matchLevel: 0,
      success: false
    }

    faceScanResponse('match-3d', payloadMatcher, response, reasonFlags)
  }

  const mock3dDatabaseEnrollmentSuccess = mockSuccessIndexEnrollment

  const mock3dDatabaseEnrollmentFailed = enrollmentIdentifier =>
    mockFailedIndexEnrollment(enrollmentIdentifier, failedEnrollmentMessage)

  return {
    enrollmentUri,
    enrollmentPayloadMatcher,
    mockErrorResponse,
    serviceErrorMessage,

    licenseUri,
    mockSuccessLicenseKey,
    mockFailedLicenseKey,

    mockSuccessSessionToken,
    mockFailedSessionToken,

    enrollmentNotFoundMessage,
    mockEnrollmentFound,
    mockEnrollmentNotFound,

    mockSuccessRemoveEnrollment,
    mockEnrollmentNotExistsDuringRemove,
    mockRemoveEnrollmentNotSupported,

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
    mockSuccessEnrollmentUnderAge,

    failedMatchMessage,
    mockSuccessUpdateEnrollment,
    mockFailedUpdateEnrollment,

    mock3dDatabaseEnrollmentSuccess,
    mock3dDatabaseEnrollmentFailed
  }
}

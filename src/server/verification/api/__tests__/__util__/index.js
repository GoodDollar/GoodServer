import {
  failedLivenessMessage,
  failedEnrollmentMessage,
  enrollmentNotFoundMessage,
  enrollmentAlreadyExistsMessage
} from '../../ZoomAPI'

export default zoomServiceMock => {
  const serviceErrorMessage = 'Request failed with status code 500'
  const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'
  const dbInternalEnrollmentAlreadyExists = `An enrollment already exists for this externalDatabaseRefID.`
  const dbInternalEnrollmentDoesntExists = 'An enrollment does not exist for this externalDatabaseRefID.'

  const enrollmentUri = enrollmentIdentifier => `/enrollment-3d/${encodeURIComponent(enrollmentIdentifier)}`

  const successResponse = { success: true, error: false }

  const mockErrorResponse = message => ({
    error: true,
    errorMessage: message,
    success: false
  })

  const faceScanResponse = (operation, response = {}, reasonFlags = {}) =>
    zoomServiceMock.onPost(`/${operation}-3d`).reply(200, {
      faceScanSecurityChecks: {
        replayCheckSucceeded: true,
        sessionTokenCheckSucceeded: true,
        auditTrailVerificationCheckSucceeded: true,
        faceScanLivenessCheckSucceeded: true,
        ...reasonFlags
      },
      success: true,
      error: false,
      ...response
    })

  const dbSuccessResponse = (operation, response = {}) =>
    zoomServiceMock.onPost(`/3d-db/${operation}`).reply(200, {
      ...successResponse,
      ...response
    })

  const dbFailedResponse = (operation, message = null) => {
    const mockedResponse = message ? mockErrorResponse(message) : { success: false, error: false }

    zoomServiceMock.onPost(`/3d-db/${operation}`).reply(200, mockedResponse)
  }

  const mockSuccessSessionToken = sessionToken =>
    zoomServiceMock.onGet('/session-token').reply(200, {
      error: false,
      sessionToken,
      success: true
    })

  const mockFailedSessionToken = (withMessage = null) =>
    zoomServiceMock.onGet('/session-token').reply(403, mockErrorResponse(withMessage))

  const mockEnrollmentFound = enrollmentIdentifier =>
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(200, {
      externalDatabaseRefID: enrollmentIdentifier,
      faceMapBase64: Buffer.alloc(32).toString(),
      auditTrailBase64: 'data:image/png:FaKEimagE==',
      success: true,
      error: false
    })

  const mockEnrollmentNotFound = enrollmentIdentifier =>
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(200, {
      errorMessage: 'No entry found in the database for this externalDatabaseRefID.',
      success: false,
      error: true
    })

  const mockSuccessLivenessCheck = () => faceScanResponse('liveness')

  const mockFailedLivenessCheck = (withReasonFlags = {}) => {
    const reasonFlags = {
      faceScanLivenessCheckSucceeded: false,
      ...withReasonFlags
    }

    faceScanResponse('liveness', { success: false }, reasonFlags)
  }

  const mockSuccessIndexEnrollment = () => dbSuccessResponse('enroll')

  const mockFailedIndexEnrollment = message => dbFailedResponse('enroll', message)

  const mockEnrollmentNotExistsDuringIndex = () => dbFailedResponse('enroll', dbInternalEnrollmentDoesntExists)

  const mockSuccessReadEnrollmentIndex = () => dbSuccessResponse('get')

  const mockFailedReadEnrollmentIndex = message => dbFailedResponse('get', message)

  // 3d-db/get doesn't returns 'An enrollment does not exist' just success: false
  const mockEnrollmentNotExistsDuringReadIndex = () => dbFailedResponse('get')

  const mockSuccessRemoveEnrollmentFromIndex = () => dbSuccessResponse('delete')

  const mockFailedRemoveEnrollmentFromIndex = message => dbFailedResponse('delete', message)

  // 3d-db/delete doesn't returns 'An enrollment does not exist' just success: false
  const mockEnrollmentNotExistsDuringRemoveFromIndex = () => dbFailedResponse('delete')

  const mockServiceErrorDuringRemoveFromIndex = () => zoomServiceMock.onPost('/3d-db/delete').reply(500)

  const mockEmptyResultsFaceSearch = () => dbSuccessResponse('search', { results: [] })

  const mockDuplicateFound = () =>
    dbSuccessResponse('search', {
      results: [
        {
          identifier: duplicateEnrollmentIdentifier,
          matchLevel: 10
        }
      ]
    })

  const mockFailedSearch = message => dbFailedResponse('search', message)

  const mockEnrollmentNotExistsDuringSearch = () => dbFailedResponse('search', dbInternalEnrollmentDoesntExists)

  const mockSuccessEnrollment = enrollmentIdentifier =>
    faceScanResponse('enrollment', {
      externalDatabaseRefID: enrollmentIdentifier
    })

  const mockFailedEnrollment = (enrollmentIdentifier, withReasonFlags = {}) => {
    const reasonFlags = {
      faceScanLivenessCheckSucceeded: false,
      ...withReasonFlags
    }

    const response = {
      success: false,
      externalDatabaseRefID: enrollmentIdentifier
    }

    faceScanResponse('enrollment', response, reasonFlags)
  }

  const mockEnrollmentAlreadyExists = () =>
    zoomServiceMock.onPost('/enrollment-3d').reply(200, mockErrorResponse(dbInternalEnrollmentAlreadyExists))

  return {
    enrollmentUri,
    mockErrorResponse,
    serviceErrorMessage,

    mockSuccessSessionToken,
    mockFailedSessionToken,

    enrollmentNotFoundMessage,
    mockEnrollmentFound,
    mockEnrollmentNotFound,

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
    mockEmptyResultsFaceSearch,
    mockDuplicateFound,
    mockFailedSearch,
    mockEnrollmentNotExistsDuringSearch,

    failedEnrollmentMessage,
    enrollmentAlreadyExistsMessage,
    mockSuccessEnrollment,
    mockFailedEnrollment,
    mockEnrollmentAlreadyExists
  }
}

import { failedLivenessMessage, enrollmentNotFoundMessage } from '../../ZoomAPI'

export default zoomServiceMock => {
  const serviceErrorMessage = 'Request failed with status code 500'

  const failedEnrollmentMessage = 'The FaceMap was not enrolled because Liveness could not be determined.'
  const failedSearchMessage = '3D FaceMaps that are used with Search APIs must have had Liveness Proven.'
  const enrollmentDisposedMessage = 'The entry in the database for this enrollmentIdentifier was successfully deleted'
  const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`
  const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'

  const enrollmentUri = enrollmentIdentifier => `/enrollment-3d/${encodeURIComponent(enrollmentIdentifier)}`

  const mockSuccessSessionToken = sessionToken =>
    zoomServiceMock.onGet('/session-token').reply(200, {
      error: false,
      sessionToken,
      success: true
    })

  const mockFailedSessionToken = (withMessage = null) =>
    zoomServiceMock.onGet('/session-token').reply(403, {
      error: true,
      errorMessage: withMessage,
      success: false
    })

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

  const mockSuccessLivenessCheck = () => faceScanResponse('liveness')

  const mockFailedLivenessCheck = (withReasonFlags = {}) => {
    const reasonFlags = {
      faceScanLivenessCheckSucceeded: false,
      ...withReasonFlags
    }

    faceScanResponse('liveness', { success: false }, reasonFlags)
  }
  /*

  const mockEmptyResultsFaceSearch = () =>
    zoomServiceMock.onPost('/search').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The search request was processed successfully.'
      },
      data: {
        results: [],
        sourceFaceMap: {
          isReplayFaceMap: false
        }
      }
    })

  const mockDuplicateFound = () =>
    zoomServiceMock.onPost('/search').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The search request was processed successfully.'
      },
      data: {
        results: [
          {
            enrollmentIdentifier: duplicateEnrollmentIdentifier,
            matchLevel: '1',
            auditTrailImage: 'data:image/png:FaKEimagE=='
          }
        ]
      }
    })

  const mockFailedSearch = () =>
    zoomServiceMock.onPost('/search').reply(200, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: '3D FaceMaps that are used with Search APIs must have had Liveness Proven.'
      },
      data: {
        glasses: false,
        sessionTokenStatus: 1,
        faceMapType: 0,
        livenessStatus: 1,
        isLowQuality: false
      }
    })

  const mockSuccessEnrollment = enrollmentIdentifier =>
    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The FaceMap was successfully enrolled.'
      },
      data: {
        createdDate: '2019-09-16T17:30:40+00:00',
        enrollmentIdentifier,
        faceMapType: 0,
        glasses: false,
        isEnrolled: true,
        isLowQuality: false,
        isReplayFaceMap: false,
        livenessStatus: 0
      }
    })

  const mockFailedEnrollment = (enrollmentIdentifier, customResponse = {}) =>
    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: failedEnrollmentMessage
      },
      data: {
        auditTrailVerificationMessage: '...',
        auditTrailVerificationStatus: 0,
        createdDate: '2019-09-16T17:30:40+00:00',
        enrollmentIdentifier,
        errorMessageFromZoomServer: null,
        errorStatusFromZoomServer: 0,
        faceMapType: 1,
        glasses: false,
        isEnrolled: false,
        isLowQuality: false,
        isReplayFaceMap: false,
        livenessStatus: null,
        ...customResponse
      }
    })

    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: enrollmentNotFoundMessage
      }
    })
  }

  const mockServiceErrorHappenedWhileDisposing = enrollmentIdentifier =>
    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(500)*/

  return {
    enrollmentUri,
    serviceErrorMessage,

    mockSuccessSessionToken,
    mockFailedSessionToken,

    enrollmentNotFoundMessage,
    mockEnrollmentFound,
    mockEnrollmentNotFound,

    failedLivenessMessage,
    mockSuccessLivenessCheck,
    mockFailedLivenessCheck

    /*mockEmptyResultsFaceSearch,
    mockDuplicateFound,
    duplicateEnrollmentIdentifier,
    duplicateFoundMessage,
    mockFailedSearch,
    failedSearchMessage,

    mockSuccessEnrollment,
    mockFailedEnrollment,
    failedEnrollmentMessage,

    enrollmentDisposedMessage,
    mockServiceErrorHappenedWhileDisposing*/
  }
}

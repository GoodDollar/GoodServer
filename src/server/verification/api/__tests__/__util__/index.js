export default zoomServiceMock => {
  const serviceErrorMessage = 'Request failed with status code 500'
  const failedEnrollmentMessage = 'The FaceMap was not enrolled because Liveness could not be determined.'
  const enrollmentDisposedMessage = 'The entry in the database for this enrollmentIdentifier was successfully deleted'
  const enrollmentFoundMessage = 'A FaceMap was found for that enrollmentIdentifier.'
  const enrollmentNotFoundMessage = 'No entry found in the database for this enrollmentIdentifier.'
  const duplicateFoundMessage = `Duplicate exists for FaceMap you're trying to enroll.`
  const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'

  const enrollmentUri = enrollmentIdentifier => `/enrollment/${encodeURIComponent(enrollmentIdentifier)}`

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

  const mockEnrollmentFound = enrollmentIdentifier => {
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: enrollmentFoundMessage
      },
      data: {
        createdDate: '2019-09-16T17:30:40+00:00',
        enrollmentIdentifier,
        faceMap: Buffer.alloc(32).toString(),
        auditTrailImage: 'data:image/png:FaKEimagE==',
        faceMapType: 0
      }
    })

    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: enrollmentDisposedMessage
      }
    })
  }

  const mockEnrollmentNotFound = enrollmentIdentifier => {
    zoomServiceMock.onGet(enrollmentUri(enrollmentIdentifier)).reply(400, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: enrollmentNotFoundMessage,
        subCode: 'facemapNotFound'
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
    zoomServiceMock.onDelete(enrollmentUri(enrollmentIdentifier)).reply(500)

  return {
    enrollmentUri,
    serviceErrorMessage,

    mockEmptyResultsFaceSearch,
    mockDuplicateFound,
    duplicateEnrollmentIdentifier,
    duplicateFoundMessage,

    mockSuccessEnrollment,
    mockFailedEnrollment,
    failedEnrollmentMessage,

    mockEnrollmentFound,
    mockEnrollmentNotFound,
    enrollmentFoundMessage,
    enrollmentNotFoundMessage,
    enrollmentDisposedMessage,
    mockServiceErrorHappenedWhileDisposing
  }
}

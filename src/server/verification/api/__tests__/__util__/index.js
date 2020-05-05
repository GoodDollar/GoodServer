export default zoomServiceMock => {
  const failedEnrollmentMessage = 'The FaceMap was not enrolled because Liveness could not be determined.'
  const failedRemovalMessage = 'No entry found in the database for this enrollmentIdentifier.'
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

  const mockDuplicatesFound = zoomServiceMock.onPost('/search').reply(200, {
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

  const mockFailedRemoval = () =>
    zoomServiceMock.onDelete(/\/enrollment\/.+/).reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: failedRemovalMessage
      }
    })

  return {
    enrollmentUri,

    mockEmptyResultsFaceSearch,
    mockDuplicatesFound,
    duplicateEnrollmentIdentifier,
    duplicateFoundMessage,

    mockSuccessEnrollment,
    mockFailedEnrollment,
    failedEnrollmentMessage,

    failedRemovalMessage,
    mockFailedRemoval
  }
}

export default zoomServiceMock => {
  const failedLivenessCheckMessage =
    'Liveness was not processed. This occurs when ' +
    'processing ZoOm 2D FaceMaps because they do not have enough data to determine Liveness.'

  const failedEnrollmentMessage = 'The FaceMap was not enrolled because Liveness could not be determined.'

  const mockSuccessLivenessCheck = () =>
    zoomServiceMock.onPost('/liveness').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The FaceTec 3D FaceMap evaluated and Liveness was proven.'
      },
      data: {
        glasses: false,
        isLowQuality: false,
        isReplayFaceMap: true,
        livenessStatus: 0
      }
    })

  const mockFailedLivenessCheck = (customResponse = {}) =>
    zoomServiceMock.onPost('/liveness').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: failedLivenessCheckMessage
      },
      data: {
        glasses: false,
        isLowQuality: false,
        isReplayFaceMap: true,
        livenessStatus: 2,
        ...customResponse
      }
    })

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

  const mockFailedEnrollment = enrollmentIdentifier =>
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
        livenessStatus: null
      }
    })

  return {
    mockSuccessLivenessCheck,
    mockFailedLivenessCheck,
    failedLivenessCheckMessage,

    mockEmptyResultsFaceSearch,

    mockSuccessEnrollment,
    mockFailedEnrollment,
    failedEnrollmentMessage
  }
}

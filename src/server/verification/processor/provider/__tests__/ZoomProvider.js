// @flow

import MockAdapter from 'axios-mock-adapter'

import ZoomProvider from '../ZoomProvider'

let zoomServiceMock
const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: 'fake-session-id',
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE==',
  lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
}

const ResponseSuccessLiveness = {
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
}

const ResponseSuccessEnroll = {
  meta: {
    ok: true,
    code: 200,
    mode: 'dev',
    message: 'The FaceMap was successfully enrolled.'
  },
  data: {
    createdDate: '2019-09-16T17:30:40+00:00',
    enrollmentIdentifier: enrollmentIdentifier,
    faceMapType: 0,
    glasses: false,
    isEnrolled: true,
    isLowQuality: false,
    isReplayFaceMap: false,
    livenessStatus: 0
  }
}

describe('ZoomProvider', () => {
  beforeAll(() => {
    zoomServiceMock = new MockAdapter(ZoomProvider.api.http)
  })

  afterEach(() => zoomServiceMock.reset())

  afterAll(() => {
    zoomServiceMock.restore()
    zoomServiceMock = null
  })

  test('isValid() validates payload if facemap and images are present', () => {
    expect(ZoomProvider.isPayloadValid(payload)).toBeTruthy()
    expect(ZoomProvider.isPayloadValid({})).toBeFalsy()
  })

  test('enroll() returns successfull response if liveness passed, no duplicates and enrollment successfull', async () => {
    zoomServiceMock.onPost('/liveness').reply(200, ResponseSuccessLiveness)
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
    zoomServiceMock.onPost('/enrollment').reply(200, ResponseSuccessEnroll)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() returns successfull response if identifier was alreadsy enrolled', async () => {
    zoomServiceMock.onPost('/liveness').reply(200, ResponseSuccessLiveness)
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
            enrollmentIdentifier: enrollmentIdentifier,
            matchLevel: '0',
            auditTrailImage: 'data:image/png:FaKEimagE=='
          }
        ],
        sourceFaceMap: {
          isReplayFaceMap: false
        }
      }
    })
    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: 'An enrollment already exists for this enrollmentIdentifier.',
        subCode: 'nameCollision'
      }
    })

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', true)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() throws if liveness check fails', async () => {
    zoomServiceMock.onPost('/liveness').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message:
          'Liveness was not processed. This occurs when processing ZoOm 2D FaceMaps because they do not have enough data to determine Liveness.'
      },
      data: {
        glasses: false,
        isLowQuality: false,
        isReplayFaceMap: true,
        livenessStatus: 2
      }
    })

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(
      'Liveness was not processed. This occurs when processing ZoOm 2D FaceMaps because they do not have enough data to determine Liveness.'
    )
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isLive', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: false })
  })

  test('enroll() throws if duplicates found', async () => {
    // via zoomServiceMock mock:
    zoomServiceMock.onPost('/liveness').reply(200, ResponseSuccessLiveness)
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
            enrollmentIdentifier: 'test_dev',
            matchLevel: '1',
            auditTrailImage: 'data:image/png:FaKEimagE=='
          }
        ]
      }
    })

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow("Duplicate with identifier 'test_dev' found.")
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isDuplicate', true)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: true })
  })

  test('enroll() throws if enrollment fails in any other case expect alreadyEnrolled', async () => {
    // via zoomServiceMock mock:
    zoomServiceMock.onPost('/liveness').reply(200, ResponseSuccessLiveness)
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
    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The FaceMap was not enrolled because Liveness could not be determined.'
      },
      data: {
        auditTrailVerificationMessage: '...',
        auditTrailVerificationStatus: 0,
        createdDate: '2019-09-16T17:30:40+00:00',
        enrollmentIdentifier: enrollmentIdentifier,
        errorMessageFromZoomServer: null,
        errorStatusFromZoomServer: 0,
        faceMapType: 1,
        glasses: true,
        isEnrolled: false,
        isLowQuality: false,
        isReplayFaceMap: false,
        livenessStatus: null
      }
    })
    // - "enrollment failed because Liveness could not be determined" /enrollment response

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow('Liveness could not be determined because wearing glasses were detected.')
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isEnrolled', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: false })
  })

  test('enroll() throws on any Zoom service error and terminates without returning any response or calling callback', async () => {
    zoomServiceMock
      .onPost('/liveness')
      .replyOnce(500)
      .onPost('/liveness')
      .networkErrorOnce()

    for (const message of ['Request failed with status code 500', 'Network Error']) {
      const onEnrollmentProcessing = jest.fn()
      const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

      await wrappedResponse.toThrow(message) // eslint-disable-line no-await-in-loop
      await wrappedResponse.not.toHaveProperty('response') // eslint-disable-line no-await-in-loop

      expect(onEnrollmentProcessing).not.toHaveBeenCalled()
    }
  })
})

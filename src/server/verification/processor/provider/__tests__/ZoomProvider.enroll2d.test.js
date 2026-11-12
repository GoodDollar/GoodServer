// @flow

import MockAdapter from 'axios-mock-adapter'
import getZoomProvider from '../ZoomProvider'
import createMockingHelper from '../../../api/__tests__/__util__'

const ZoomProvider = getZoomProvider()
let helper
let zoomServiceMock

const enrollmentIdentifier = 'fake-enrollment-identifier'
const payload = {
  // photo2d is required for enroll2d
  photo2d: 'data:image/png;fakebase64==',
  sessionId: 'fake-session',
  faceScan: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE=='
}

describe('ZoomProvider enroll2d flow', () => {
  beforeAll(() => {
    zoomServiceMock = new MockAdapter(ZoomProvider.api.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  afterEach(() => zoomServiceMock.reset())

  afterAll(() => {
    zoomServiceMock.restore()
    zoomServiceMock = null
    helper = null
  })

  test('enroll2d succeeds when liveness and 3D-2D match succeed', async () => {
    // enrollment must exist (we match against existing 3D FaceMap)
    helper.mockEnrollmentFound(enrollmentIdentifier)

    // mock 2D liveness endpoint
    zoomServiceMock.onPost('/liveness-2d').reply(200, {
      success: true,
      isLikelyRealPerson: true,
      scanResultBlob: 'liveness-blob',
      error: false
    })

    // mock 3D-2D match endpoint
    zoomServiceMock.onPost('/match-3d-2d-face-portrait').reply(200, {
      success: true,
      matchLevel: 10,
      imageProcessingStatusEnumInt: 0
    })

    // mock index check to return indexed
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    await expect(ZoomProvider.enroll2d(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves.toHaveProperty(
      'isVerified',
      true
    )

    // processor should get isLive then isNotMatch notifications
    expect(onEnrollmentProcessing).toHaveBeenCalledWith({ isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenCalledWith({ isNotMatch: false })
  })

  test('enroll2d fails when 2D liveness fails', async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
    //   const mockSuccessReadEnrollmentIndex = enrollmentIdentifier => dbSuccessResponse('get', enrollmentIdentifier)

    zoomServiceMock.onPost('/liveness-2d').reply(200, {
      success: false,
      isLikelyRealPerson: false
    })

    const onEnrollmentProcessing = jest.fn()
    const wrapped = expect(ZoomProvider.enroll2d(enrollmentIdentifier, payload, onEnrollmentProcessing))
    await wrapped.rejects.toThrow()
    expect(onEnrollmentProcessing).toHaveBeenCalledWith({ isLive: false })
  })
})

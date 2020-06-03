// @flow

import MockAdapter from 'axios-mock-adapter'

import ZoomAPI from '../ZoomAPI'
import createMockingHelper from './__util__'

let helper
let zoomServiceMock

const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: 'fake-session-id',
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE=='
}

const enrollmentPayload = {
  enrollmentIdentifier,
  ...payload
}

const mockedFaceSearchResults = [
  {
    enrollmentIdentifier: 'fake-id-1',
    matchLevel: '0',
    auditTrailImage: 'data:image/png:FaKEimagE=='
  },
  {
    enrollmentIdentifier: 'fake-id-2',
    matchLevel: '1',
    auditTrailImage: 'data:image/png:FaKEimagE=='
  },
  {
    enrollmentIdentifier: 'fake-id-3',
    matchLevel: '3',
    auditTrailImage: 'data:image/png:FaKEimagE=='
  }
]

const mockFaceSearch = () =>
  zoomServiceMock.onPost('/search').reply(200, {
    meta: {
      ok: true,
      code: 200,
      mode: 'dev',
      message: 'The search request was processed successfully.'
    },
    data: {
      results: mockedFaceSearchResults,
      sourceFaceMap: {
        isReplayFaceMap: false
      }
    }
  })

describe('ZoomAPI', () => {
  beforeAll(() => {
    zoomServiceMock = new MockAdapter(ZoomAPI.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  afterEach(() => zoomServiceMock.reset())

  afterAll(() => {
    zoomServiceMock.restore()
    zoomServiceMock = null
    helper = null
  })

  test('faceSearch() should return enrollments with match levels', async () => {
    mockFaceSearch()

    // setting minimum match level = 0 to get all faces
    await expect(ZoomAPI.faceSearch(payload, 0)).resolves.toHaveProperty('results', mockedFaceSearchResults)
  })

  test('faceSearch() should filter by the minimum match level', async () => {
    mockFaceSearch()

    await expect(ZoomAPI.faceSearch(payload, 2)).resolves.toHaveProperty('results', [
      {
        enrollmentIdentifier: 'fake-id-3',
        matchLevel: '3',
        auditTrailImage: 'data:image/png:FaKEimagE=='
      }
    ])
  })

  test('faceSearch() should use minimum match level defined in the .env by default', async () => {
    mockFaceSearch()

    const { results: resultsByEnvMinMatchLevel } = await ZoomAPI.faceSearch(
      payload,
      process.env.ZOOM_MINIMAL_MATCHLEVEL
    )

    const { results: resultsByDefaultMinMatchLevel } = await ZoomAPI.faceSearch(payload)

    expect(resultsByEnvMinMatchLevel).toEqual(resultsByDefaultMinMatchLevel)
  })

  test('faceSearch() should throw on service failure', async () => {
    const faceSearchServiceError = 'sessionId must be UUID in standard format.'

    zoomServiceMock.onPost('/search').reply(400, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: faceSearchServiceError,
        subCode: 'invalidSessionId'
      }
    })

    await expect(ZoomAPI.faceSearch(payload)).rejects.toThrow(faceSearchServiceError)
  })

  test('submitEnrollment() should enroll face and return enrollment status and identifier', async () => {
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.submitEnrollment(enrollmentPayload)).resolves

    await wrappedResponse.toHaveProperty('isEnrolled', true)
    await wrappedResponse.toHaveProperty('livenessStatus', 0)
    await wrappedResponse.toHaveProperty('enrollmentIdentifier', enrollmentIdentifier)
  })

  test("submitEnrollment() should throw when liveness couldn't be determined", async () => {
    helper.mockFailedEnrollment(enrollmentIdentifier)

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(helper.failedEnrollmentMessage)
  })

  test('submitEnrollment() handles low photo quality', async () => {
    helper.mockFailedEnrollment(enrollmentIdentifier, { isLowQuality: true })

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(
      'Liveness could not be determined because the photoshoots evaluated to be of poor quality.'
    )
  })

  test('submitEnrollment() handles glasses weared', async () => {
    helper.mockFailedEnrollment(enrollmentIdentifier, { glasses: true })

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(
      'Liveness could not be determined because wearing glasses were detected.'
    )
  })

  test('submitEnrollment() should throw on service failures', async () => {
    const enrollmentServiceError = 'You must pass a valid FaceMap or image parameter.'

    zoomServiceMock.onPost('/enrollment').reply(400, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: enrollmentServiceError,
        subCode: 'missingParameter'
      }
    })

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(enrollmentServiceError)
  })

  test("readEnrollment() should return enrollment if it's found", async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).resolves

    await wrappedResponse.toHaveProperty('message', helper.enrollmentFoundMessage)
    await wrappedResponse.toHaveProperty('enrollmentIdentifier', enrollmentIdentifier)
  })

  test("disposeEnrollment() should dispose enrollment if it's found", async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)

    await expect(ZoomAPI.disposeEnrollment(enrollmentIdentifier)).resolves.toHaveProperty(
      'message',
      helper.enrollmentDisposedMessage
    )
  })

  test("readEnrollment() and disposeEnrollment() should throw error if enrollment isn't found", async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)

    await Promise.all(
      [ZoomAPI.readEnrollment(enrollmentIdentifier), ZoomAPI.disposeEnrollment(enrollmentIdentifier)].map(
        async promise => {
          const wrappedResponse = expect(promise).rejects

          await wrappedResponse.toThrow(helper.enrollmentNotFoundMessage)
          await wrappedResponse.toHaveProperty('response.subCode', 'facemapNotFound')
        }
      )
    )
  })

  test('API methods should throw on server / connection errors', async () => {
    zoomServiceMock
      .onPost('/enrollment')
      .networkErrorOnce()
      .onPost('/enrollment')
      .replyOnce(500)

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow('Network Error')
    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(helper.serviceErrorMessage)
  })
})

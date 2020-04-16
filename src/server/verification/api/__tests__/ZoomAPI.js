// @flow

import MockAdapter from 'axios-mock-adapter'

import ZoomAPI from '../ZoomAPI'

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

const mockFaceSearch = () =>
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
      ],
      sourceFaceMap: {
        isReplayFaceMap: false
      }
    }
  })

describe('ZoomAPI', () => {
  beforeAll(() => {
    zoomServiceMock = new MockAdapter(ZoomAPI.http)
  })

  afterEach(() => zoomServiceMock.reset())

  afterAll(() => {
    zoomServiceMock.restore()
    zoomServiceMock = null
  })

  test('detectLiveness() passes if livenessStatus === 0 (LIVENESS_PASSED)', async () => {
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

    await expect(ZoomAPI.detectLiveness(payload)).resolves.toBeDefined()
  })

  test('detectLiveness() throws if livenessStatus !== 0', async () => {
    zoomServiceMock.onPost('/liveness').reply(200, {
      // unsuccessfull liveness response from zoom api docs here
    })

    await expect(ZoomAPI.detectLiveness(payload)).rejects.toThrow('<error message from mocked response here>')
  })

  test('detectLiveness() handles low photo quality', async () => {
    // isLowQuality: true in mocked response
    // check that error message should be "Liveness could not be determined because the photoshoots evaluated to be of poor quality."
  })

  test('detectLiveness() handles glasses weared', async () => {
    // glasses: true in mocked response
    // check that error message should be "Liveness could not be determined because wearing glasses were detected."
  })

  test('detectLiveness() should throw on service failures', async () => {
    zoomServiceMock
      .onPost('/liveness')
      .replyOnce(400, {
        // any failure response from zoom api docs
      })
      .onPost('/liveness')
      .replyOnce(500)
      .onPost('/liveness')
      .networkErrorOnce()

    await expect(ZoomAPI.detectLiveness(payload)).rejects.toThrow('<error message from mocked response here>')

    await expect(ZoomAPI.detectLiveness(payload)).rejects.toThrow('Error: Request failed with status code 500')

    await expect(ZoomAPI.detectLiveness(payload)).rejects.toThrow('Error: Network Error')
  })

  test('faceSearch() should return enrollments with match levels', async () => {
    mockFaceSearch()

    // setting minimum match level = 0 to get all faces
    await expect(ZoomAPI.faceSearch(payload, 0)).resolves.toHaveProperty('results', [
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
    ])
  })

  test('faceSearch() should filter by the minimum match level', async () => {
    mockFaceSearch()

    await expect(ZoomAPI.faceSearch(payload, 2)).resolves.toHaveProperty('results', [
      // put here the faces having mtach level 2 or above
    ])
  })

  test('faceSearch() should use minimum match level defined in the .env by default', async () => {
    mockFaceSearch()

    const { results: resultsByEnvMinMatchLevel } = await ZoomAPI.faceSearch(
      payload,
      process.env.ZOOM_MINIMAL_MATCHLEVEL
    )
    const { results: resultsByDefaultMinMatchLevel } = await ZoomAPI.faceSearch(payload)

    // expect resultsByEnvMinMatchLevel to be deep equal to resultsByDefaultMinMatchLevel
  })

  test('faceSearch() should throw on service failure', async () => {
    zoomServiceMock
      .onPost('/liveness')
      .replyOnce(400, {
        // any failure response from zoom api docs
      })
      .onPost('/liveness')
      .replyOnce(500)
      .onPost('/liveness')
      .networkErrorOnce()

    await expect(ZoomAPI.faceSearch(payload)).rejects.toThrow('<error message from mocked response here>')

    await expect(ZoomAPI.faceSearch(payload)).rejects.toThrow('Error: Request failed with status code 500')

    await expect(ZoomAPI.faceSearch(payload)).rejects.toThrow('Error: Network Error')
  })

  test('submitEnrollment() should enroll face and return enrollment status and identifier', async () => {
    zoomServiceMock.onPost('/enrollment').reply(200, {
      // "enrolled successfully" response from zoom api docs
    })

    const wrappedResponse = expect(ZoomAPI.submitEnrollment(enrollmentPayload)).resolves

    await wrappedResponse.toHaveProperty('isEnrolled', true)
    await wrappedResponse.toHaveProperty('livenessStatus', 0)
    await wrappedResponse.toHaveProperty('enrollmentIdentifier', enrollmentIdentifier)
  })

  test("submitEnrollment() should throw when liveness couldn't be determined", async () => {
    zoomServiceMock.onPost('/enrollment').reply(200, {
      // "enrollment failed because Liveness could not be determined" response from zoom api docs
    })

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(
      '<error message from mocked response here>'
    )
  })

  test('submitEnrollment() should throw on service failures', async () => {
    zoomServiceMock
      .onPost('/enrollment')
      .replyOnce(400, {
        // any failure response from zoom api docs
      })
      .onPost('/enrollment')
      .replyOnce(500)
      .onPost('/enrollment')
      .networkErrorOnce()

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(
      '<error message from mocked response here>'
    )

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow(
      'Error: Request failed with status code 500'
    )

    await expect(ZoomAPI.submitEnrollment(enrollmentPayload)).rejects.toThrow('Error: Network Error')
  })
})

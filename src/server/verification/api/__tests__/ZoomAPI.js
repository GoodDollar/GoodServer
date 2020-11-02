// @flow

import MockAdapter from 'axios-mock-adapter'

import getZoomAPI, { ZoomAPIError } from '../ZoomAPI'
import createMockingHelper from './__util__'

const ZoomAPI = getZoomAPI()
let helper
let zoomServiceMock

const sessionToken = 'fake-session-id'

const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: sessionToken,
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE=='
}

/*const mockedFaceSearchResults = [
  {
    externalDatabaseRefID: 'fake-id-1',
    matchLevel: '0',
    auditTrailImage: 'data:image/png:FaKEimagE=='
  },
  {
    externalDatabaseRefID: 'fake-id-2',
    matchLevel: '1',
    auditTrailImage: 'data:image/png:FaKEimagE=='
  },
  {
    externalDatabaseRefID: 'fake-id-3',
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
  })*/

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

  test('getSessionToken() should return session token', async () => {
    helper.mockSuccessSessionToken(sessionToken)

    await expect(ZoomAPI.getSessionToken()).resolves.toHaveProperty('sessionToken', sessionToken)
  })

  test('getSessionToken() should throws if no sessionToken found in the API response', async () => {
    const message = 'Some error happened on GET /session-token call'

    helper.mockFailedSessionToken()
    await expect(ZoomAPI.getSessionToken()).rejects.toThrow('Request failed with status code 403')

    helper.mockFailedSessionToken(message)
    await expect(ZoomAPI.getSessionToken()).rejects.toThrow(message)
  })

  test('readEnrollment() should return enrollment data if it found', async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
    await wrappedResponse.toHaveProperty('externalDatabaseRefID', enrollmentIdentifier)
    await wrappedResponse.toHaveProperty('faceMapBase64')
    await wrappedResponse.toHaveProperty('auditTrailBase64')
  })

  test('readEnrollment() should throw if enrollment not found', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).rejects

    await wrappedResponse.toThrow(helper.enrollmentNotFoundMessage)
    await wrappedResponse.toHaveProperty('name', ZoomAPIError.FacemapNotFound)
  })

  test('readEnrollment() should throw on unknown/unexpected errors', async () => {
    const message = 'Some error happened on GET /enrollment-3d call'

    zoomServiceMock.onGet(helper.enrollmentUri(enrollmentIdentifier)).reply(200, {
      success: false,
      error: true,
      errorMessage: message
    })

    await expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).rejects.toThrow(message)
  })

  test('checkLiveness() should return success if liveness passed', async () => {
    helper.mockSuccessLivenessCheck()

    const wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
  })

  test('checkLiveness() should throw if liveness failed', async () => {
    helper.mockFailedLivenessCheck()

    const wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).rejects

    await wrappedResponse.toThrow(helper.failedLivenessMessage)
    await wrappedResponse.toHaveProperty('name', ZoomAPIError.LivenessCheckFailed)
  })

  test('checkLiveness() should throw with different errors depending the case happened', async () => {
    const { LivenessCheckFailed, SecurityCheckFailed } = ZoomAPIError
    const { failedLivenessMessage } = helper
    let wrappedResponse

    // failed session token
    helper.mockFailedLivenessCheck({ sessionTokenCheckSucceeded: false })
    wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).rejects
    await wrappedResponse.toThrow(
      failedLivenessMessage + ' because the session token is missing or was failed to be checked'
    )
    await wrappedResponse.toHaveProperty('name', SecurityCheckFailed)

    // failed replay check token
    helper.mockFailedLivenessCheck({ replayCheckSucceeded: false })
    wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).rejects
    await wrappedResponse.toThrow(failedLivenessMessage + ' because the replay check was failed')
    await wrappedResponse.toHaveProperty('name', SecurityCheckFailed)

    // failed photoshoots check
    helper.mockFailedLivenessCheck({ auditTrailVerificationCheckSucceeded: false })
    wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).rejects
    await wrappedResponse.toThrow(failedLivenessMessage + ' because the photoshoots evaluated to be of poor quality')
    await wrappedResponse.toHaveProperty('name', LivenessCheckFailed)
  })

  test('checkLiveness() should throw with unknown/unexpected errors', async () => {
    const unknownErrorMessage = 'Unknown exception happened during liveness request'

    // set all flags to true, so we'll have success: false and unknown reason
    helper.mockFailedLivenessCheck({ faceScanLivenessCheckSucceeded: true })

    await expect(ZoomAPI.checkLiveness(payload)).rejects.toThrow(unknownErrorMessage)

    zoomServiceMock.onPost('/liveness-3d').reply(200, {
      success: false,
      error: true,
      errorMessage: unknownErrorMessage
    })

    await expect(ZoomAPI.checkLiveness(payload)).rejects.toThrow(unknownErrorMessage)
  })

  /*
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

    zoomServiceMock.onPost('/search').reply(200, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: faceSearchServiceError
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

  test('submitEnrollment() should throw on service failures', async () => {
    const enrollmentServiceError = 'You must pass a valid FaceMap or image parameter.'

    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: false,
        code: 400,
        mode: 'dev',
        message: enrollmentServiceError
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
  })*/

  test('API methods should throw on server / connection errors', async () => {
    zoomServiceMock
      .onPost('/enrollment-3d')
      .networkErrorOnce()
      .onPost('/enrollment-3d')
      .replyOnce(500)

    await expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).rejects.toThrow('Network Error')
    await expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).rejects.toThrow(helper.serviceErrorMessage)
  })
})

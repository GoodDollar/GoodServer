// @flow

import MockAdapter from 'axios-mock-adapter'

import config from '../../../server.config'
import getZoomAPI, { ZoomAPIError } from '../ZoomAPI'
import createMockingHelper from './__util__'

const ZoomAPI = getZoomAPI()
let helper
let zoomServiceMock

const matchLevel = 10
const indexName = 'fake-index'
const sessionToken = 'fake-session-id'
const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: sessionToken,
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE=='
}

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

  test('readEnrollment() should throw on unknown / service errors', async () => {
    const message = 'Some error happened on GET /enrollment-3d call'

    zoomServiceMock.onGet(helper.enrollmentUri(enrollmentIdentifier)).reply(200, helper.mockErrorResponse(message))

    await expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).rejects.toThrow(message)
  })

  test('checkLiveness() should return success if liveness passed', async () => {
    helper.mockSuccessLivenessCheck()

    const wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
  })

  test('checkLiveness() / submitEnrollment() should throw if liveness failed', async () => {
    helper.mockFailedLivenessCheck()
    helper.mockFailedEnrollment(enrollmentIdentifier)

    await Promise.all(
      [ZoomAPI.checkLiveness(payload), ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)].map(async promise => {
        const wrappedResponse = expect(promise).rejects

        await wrappedResponse.toThrow(helper.failedLivenessMessage)
        await wrappedResponse.toHaveProperty('name', ZoomAPIError.LivenessCheckFailed)
      })
    )
  })

  test('checkLiveness() / submitEnrollment() should throw with different errors depending the case happened', async () => {
    const { LivenessCheckFailed, SecurityCheckFailed } = ZoomAPIError
    const { failedLivenessMessage, failedEnrollmentMessage } = helper
    let wrappedResponse

    const shouldThrowWith = (name, message) =>
      Promise.all(
        [ZoomAPI.checkLiveness(payload), ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)].map(
          async (promise, index) => {
            let prefix = failedLivenessMessage

            if (index && name === SecurityCheckFailed) {
              prefix = failedEnrollmentMessage
            }

            wrappedResponse = expect(promise).rejects

            await wrappedResponse.toThrow(`${prefix} because the ${message}`)
            await wrappedResponse.toHaveProperty('name', name)
          }
        )
      )

    const fixture = [
      {
        // failed session token
        flags: { sessionTokenCheckSucceeded: false },
        name: SecurityCheckFailed,
        message: 'session token is missing or was failed to be checked'
      },
      {
        // failed replay check token
        flags: { replayCheckSucceeded: false },
        name: SecurityCheckFailed,
        message: 'replay check was failed'
      },
      {
        // failed photoshoots check
        flags: { auditTrailVerificationCheckSucceeded: false },
        name: LivenessCheckFailed,
        message: 'photoshoots evaluated to be of poor quality'
      }
    ]

    await fixture.reduce(
      (promise, { flags, name, message }) =>
        promise.then(async () => {
          helper.mockFailedLivenessCheck(flags)
          helper.mockFailedEnrollment(enrollmentIdentifier, flags)

          await shouldThrowWith(name, message)
        }),
      Promise.resolve()
    )
  })

  test('checkLiveness() / submitEnrollment() should throw with unknown / service errors', async () => {
    const operations = ['liveness', 'enrollment']
    const messages = operations.map(operation => `Unknown exception happened during ${operation} request`)

    const shouldThrowWithUnknownError = () =>
      Promise.all(
        [
          ZoomAPI.checkLiveness(payload),
          ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)
        ].map((promise, index) => expect(promise).rejects.toThrow(messages[index]))
      )

    // set all flags to true, so we'll have success: false and unknown reason
    helper.mockFailedLivenessCheck({ faceScanLivenessCheckSucceeded: true })
    helper.mockFailedEnrollment(enrollmentIdentifier, { faceScanLivenessCheckSucceeded: true })

    await shouldThrowWithUnknownError()

    operations.forEach((operation, index) =>
      zoomServiceMock.onPost(`/${operation}-3d`).reply(200, helper.mockErrorResponse(messages[index]))
    )

    await shouldThrowWithUnknownError()
  })

  test('enrollments index (add / read / remove) methods should return success', async () => {
    helper.mockSuccessIndexEnrollment()
    helper.mockSuccessReadEnrollmentIndex()
    helper.mockSuccessRemoveEnrollmentFromIndex()

    await Promise.all(
      [
        ZoomAPI.indexEnrollment(enrollmentIdentifier, indexName),
        ZoomAPI.readEnrollmentIndex(enrollmentIdentifier, indexName),
        ZoomAPI.removeEnrollmentFromIndex(enrollmentIdentifier, indexName)
      ].map(async promise => {
        const wrappedResponse = expect(promise).resolves

        await wrappedResponse.toHaveProperty('success', true)
        await wrappedResponse.toHaveProperty('error', false)
      })
    )
  })

  test('enrollments index (add / read / remove / search) methods should use default index', async () => {
    const { zoomSearchIndexName } = config

    helper.mockSuccessIndexEnrollment()
    helper.mockSuccessReadEnrollmentIndex()
    helper.mockSuccessRemoveEnrollmentFromIndex()
    helper.mockEmptyResultsFaceSearch()

    await Promise.all([
      ZoomAPI.indexEnrollment(enrollmentIdentifier),
      ZoomAPI.readEnrollmentIndex(enrollmentIdentifier),
      ZoomAPI.removeEnrollmentFromIndex(enrollmentIdentifier),
      ZoomAPI.faceSearch(enrollmentIdentifier, matchLevel)
    ])

    zoomServiceMock.history.post.forEach(({ data }) => {
      expect(JSON.parse(data)).toHaveProperty('groupName', zoomSearchIndexName)
    })
  })

  test("enrollments index (add / read / remove / search) methods should throw in enrollment doesn't exists", async () => {
    helper.mockEnrollmentNotExistsDuringIndex()
    helper.mockEnrollmentNotExistsDuringReadIndex()
    helper.mockEnrollmentNotExistsDuringRemoveFromIndex()
    helper.mockEnrollmentNotExistsDuringSearch()

    await Promise.all(
      [
        ZoomAPI.indexEnrollment(enrollmentIdentifier, indexName),
        ZoomAPI.readEnrollmentIndex(enrollmentIdentifier, indexName),
        ZoomAPI.removeEnrollmentFromIndex(enrollmentIdentifier, indexName),
        ZoomAPI.faceSearch(enrollmentIdentifier, matchLevel, indexName)
      ].map(promise => expect(promise).rejects.toThrow(helper.enrollmentNotFoundMessage))
    )
  })

  test('enrollments index (add / read / remove / search) methods should throw on unknown / service errors', async () => {
    const failedMessages = ['enroll', 'get', 'delete', 'search'].map(
      operation => `Some error happened on POST /3d-db/${operation} call`
    )

    const [failedIndexMessage, failedReadIndexMessage, failedRemoveMessage, failedSearchMessage] = failedMessages

    helper.mockFailedIndexEnrollment(failedIndexMessage)
    helper.mockFailedReadEnrollmentIndex(failedReadIndexMessage)
    helper.mockFailedRemoveEnrollmentFromIndex(failedRemoveMessage)
    helper.mockFailedSearch(failedSearchMessage)

    await Promise.all(
      [
        ZoomAPI.indexEnrollment(enrollmentIdentifier, indexName),
        ZoomAPI.readEnrollmentIndex(enrollmentIdentifier, indexName),
        ZoomAPI.removeEnrollmentFromIndex(enrollmentIdentifier, indexName),
        ZoomAPI.faceSearch(enrollmentIdentifier, matchLevel, indexName)
      ].map((promise, index) => expect(promise).rejects.toThrow(failedMessages[index]))
    )
  })

  test('faceSearch() should return enrollments with match levels', async () => {
    helper.mockDuplicateFound()

    const promise = ZoomAPI.faceSearch(enrollmentIdentifier, matchLevel, indexName)
    const wrappedResponse = expect(promise).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
    await wrappedResponse.toHaveProperty('results')

    const {
      results: [duplicate]
    } = await promise

    expect(duplicate).toHaveProperty('identifier', helper.duplicateEnrollmentIdentifier)
    expect(duplicate).toHaveProperty('matchLevel')
    expect(duplicate.matchLevel).toBeGreaterThanOrEqual(matchLevel)
  })

  test('faceSearch() should use default match level', async () => {
    const { zoomMinimalMatchLevel } = config

    helper.mockEmptyResultsFaceSearch()
    await ZoomAPI.faceSearch(enrollmentIdentifier)

    zoomServiceMock.history.post.forEach(({ data }) => {
      expect(JSON.parse(data)).toHaveProperty('minMatchLevel', zoomMinimalMatchLevel)
    })
  })

  test('submitEnrollment() should enroll face and return enrollment identifier', async () => {
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
    await wrappedResponse.toHaveProperty('externalDatabaseRefID', enrollmentIdentifier)
  })

  test('submitEnrollment() should throw if enrollment already exists', async () => {
    helper.mockEnrollmentAlreadyExists(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).rejects

    await wrappedResponse.toThrow(helper.enrollmentAlreadyExistsMessage)
    await wrappedResponse.toHaveProperty('name', ZoomAPIError.NameCollision)
  })

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

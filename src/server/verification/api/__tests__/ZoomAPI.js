// @flow

import MockAdapter from 'axios-mock-adapter'
import { toUpper, upperFirst } from 'lodash'
import allSettled from 'promise.allsettled'

import config from '../../../server.config'
import getZoomAPI from '../ZoomAPI'
import { ZoomAPIError } from '../../utils/constants'
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
  faceScan: Buffer.alloc(32),
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

  const testNotFoundException = async response => {
    await response.toThrow(helper.enrollmentNotFoundMessage)
    await response.toHaveProperty('name', ZoomAPIError.FacemapNotFound)
  }

  const mockEnrollmentServiceError = (enrollmentIdentifier, operation) => {
    const message = `Some error happened on ${toUpper(operation)} /enrollment-3d call`

    zoomServiceMock[`on${upperFirst(operation)}`](helper.enrollmentUri(enrollmentIdentifier)).reply(
      200,
      helper.mockErrorResponse(message)
    )

    return message
  }

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

    await testNotFoundException(wrappedResponse)
  })

  test('readEnrollment() should throw on unknown / service errors', async () => {
    const message = mockEnrollmentServiceError(enrollmentIdentifier, 'get')

    await expect(ZoomAPI.readEnrollment(enrollmentIdentifier)).rejects.toThrow(message)
  })

  test('disposeEnrollment() should return success if it found', async () => {
    helper.mockSuccessRemoveEnrollment(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.disposeEnrollment(enrollmentIdentifier)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
  })

  test('disposeEnrollment() should throw if enrollment not found', async () => {
    helper.mockEnrollmentNotExistsDuringRemove(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.disposeEnrollment(enrollmentIdentifier)).rejects

    await testNotFoundException(wrappedResponse)
  })

  test("disposeEnrollment() should throw if isn't supported by the server", async () => {
    helper.mockRemoveEnrollmentNotSupported(enrollmentIdentifier)

    await expect(ZoomAPI.disposeEnrollment(enrollmentIdentifier)).rejects.toThrow(/enrollment\s+already\s+exists/i)
  })

  test('disposeEnrollment() should throw on unknown / service errors', async () => {
    const message = mockEnrollmentServiceError(enrollmentIdentifier, 'delete')

    await expect(ZoomAPI.disposeEnrollment(enrollmentIdentifier)).rejects.toThrow(message)
  })

  test('checkLiveness() should return success if liveness passed', async () => {
    helper.mockSuccessLivenessCheck()

    const wrappedResponse = expect(ZoomAPI.checkLiveness(payload)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
  })

  test('checkLiveness() / submitEnrollment() / updateEnrollment() should throw if liveness failed', async () => {
    helper.mockFailedLivenessCheck()
    helper.mockFailedEnrollment(enrollmentIdentifier)
    helper.mockFailedUpdateEnrollment(enrollmentIdentifier)

    await allSettled(
      [
        ZoomAPI.checkLiveness(payload),
        ZoomAPI.submitEnrollment(enrollmentIdentifier, payload),
        ZoomAPI.updateEnrollment(enrollmentIdentifier, payload)
      ].map(async promise => {
        const wrappedResponse = expect(promise).rejects

        await wrappedResponse.toThrow(helper.failedLivenessMessage)
        await wrappedResponse.toHaveProperty('name', ZoomAPIError.LivenessCheckFailed)
      })
    )
  })

  test('checkLiveness() / submitEnrollment() / updateEnrollment() should throw with different errors depending the case happened', async () => {
    const { LivenessCheckFailed, SecurityCheckFailed } = ZoomAPIError
    const { failedLivenessMessage, failedEnrollmentMessage } = helper
    let wrappedResponse

    const shouldThrowWith = (name, message) =>
      allSettled(
        [
          ZoomAPI.checkLiveness(payload),
          ZoomAPI.submitEnrollment(enrollmentIdentifier, payload),
          ZoomAPI.updateEnrollment(enrollmentIdentifier, payload)
        ].map(async (promise, index) => {
          let prefix = failedLivenessMessage

          if (index && name === SecurityCheckFailed) {
            prefix = failedEnrollmentMessage
          }

          wrappedResponse = expect(promise).rejects

          await wrappedResponse.toThrow(`${prefix} because the ${message}`)
          await wrappedResponse.toHaveProperty('name', name)
        })
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
          helper.mockFailedUpdateEnrollment(enrollmentIdentifier, false, flags)

          await shouldThrowWith(name, message)
        }),
      Promise.resolve()
    )
  })

  test('checkLiveness() / submitEnrollment() / updateEnrollment() should throw with unknown / service errors', async () => {
    const operations = ['liveness', 'enrollment', 'match-3d']
    const messages = operations.map(operation => `Unknown exception happened during ${operation} request`)

    const shouldThrowWithUnknownError = () =>
      allSettled(
        [
          ZoomAPI.checkLiveness(payload),
          ZoomAPI.submitEnrollment(enrollmentIdentifier, payload),
          ZoomAPI.updateEnrollment(enrollmentIdentifier, payload)
        ].map((promise, index) => expect(promise).rejects.toThrow(messages[index]))
      )

    // set all flags to true, so we'll have success: false and unknown reason
    helper.mockFailedLivenessCheck({ faceScanLivenessCheckSucceeded: true })
    helper.mockFailedEnrollment(enrollmentIdentifier, { faceScanLivenessCheckSucceeded: true })
    helper.mockFailedUpdateEnrollment(enrollmentIdentifier, false, { faceScanLivenessCheckSucceeded: true })

    await shouldThrowWithUnknownError()

    operations.forEach((operation, index) =>
      zoomServiceMock.onPost(`/${operation}-3d`).reply(200, helper.mockErrorResponse(messages[index]))
    )

    await shouldThrowWithUnknownError()
  })

  test('enrollments index (add / read / remove) methods should return success', async () => {
    helper.mockSuccessIndexEnrollment(enrollmentIdentifier)
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
    helper.mockSuccessRemoveEnrollmentFromIndex(enrollmentIdentifier)

    await allSettled(
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

    helper.mockSuccessIndexEnrollment(enrollmentIdentifier)
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
    helper.mockSuccessRemoveEnrollmentFromIndex(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)

    await allSettled([
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
    helper.mockEnrollmentNotExistsDuringIndex(enrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringReadIndex(enrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringRemoveFromIndex(enrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringSearch(enrollmentIdentifier)

    await allSettled(
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

    helper.mockFailedIndexEnrollment(enrollmentIdentifier, failedIndexMessage)
    helper.mockFailedReadEnrollmentIndex(enrollmentIdentifier, failedReadIndexMessage)
    helper.mockFailedRemoveEnrollmentFromIndex(enrollmentIdentifier, failedRemoveMessage)
    helper.mockFailedSearch(enrollmentIdentifier, failedSearchMessage)

    await allSettled(
      [
        ZoomAPI.indexEnrollment(enrollmentIdentifier, indexName),
        ZoomAPI.readEnrollmentIndex(enrollmentIdentifier, indexName),
        ZoomAPI.removeEnrollmentFromIndex(enrollmentIdentifier, indexName),
        ZoomAPI.faceSearch(enrollmentIdentifier, matchLevel, indexName)
      ].map((promise, index) => expect(promise).rejects.toThrow(failedMessages[index]))
    )
  })

  test('faceSearch() should return enrollments with match levels', async () => {
    helper.mockDuplicateFound(enrollmentIdentifier)

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

    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    await ZoomAPI.faceSearch(enrollmentIdentifier)

    zoomServiceMock.history.post.forEach(({ data }) => {
      expect(JSON.parse(data)).toHaveProperty('minMatchLevel', zoomMinimalMatchLevel)
    })
  })

  test("faceSearch() should return empty results if index doesn't initialized yet", async () => {
    helper.mockSearchIndexNotInitialized(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.faceSearch(enrollmentIdentifier)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
    await wrappedResponse.toHaveProperty('results', [])
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

  test('updateEnrollment() should match/update face and return enrollment identifier', async () => {
    helper.mockSuccessUpdateEnrollment(enrollmentIdentifier)

    const wrappedResponse = expect(ZoomAPI.updateEnrollment(enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('error', false)
    await wrappedResponse.toHaveProperty('externalDatabaseRefID', enrollmentIdentifier)
  })

  test("updateEnrollment() should throw if faceMap doesn't match", async () => {
    helper.mockFailedUpdateEnrollment(enrollmentIdentifier, true)

    const wrappedResponse = expect(ZoomAPI.updateEnrollment(enrollmentIdentifier, payload)).rejects

    await wrappedResponse.toThrow(/face\s+map.+?doesn.t\s+match/i)
    await wrappedResponse.toHaveProperty('name', ZoomAPIError.FacemapDoesNotMatch)
  })

  test('API methods should throw on server / connection errors', async () => {
    const payloadMatcher = helper.enrollmentPayloadMatcher(enrollmentIdentifier)

    zoomServiceMock
      .onPost('/enrollment-3d', payloadMatcher)
      .networkErrorOnce()
      .onPost('/enrollment-3d', payloadMatcher)
      .replyOnce(500)

    await expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).rejects.toThrow('Network Error')
    await expect(ZoomAPI.submitEnrollment(enrollmentIdentifier, payload)).rejects.toThrow(helper.serviceErrorMessage)
  })
})

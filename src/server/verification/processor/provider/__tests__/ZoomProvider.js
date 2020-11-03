// @flow

import MockAdapter from 'axios-mock-adapter'

import getZoomProvider from '../ZoomProvider'
import createMockingHelper from '../../../api/__tests__/__util__'

const ZoomProvider = getZoomProvider()
let helper
let zoomServiceMock

const sessionToken = 'fake-session-id'
const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: sessionToken,
  faceScan: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE==',
  lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
}

const testSuccessfullEnrollment = async (alreadyEnrolled = false) => {
  const onEnrollmentProcessing = jest.fn()
  const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

  await wrappedResponse.toHaveProperty('isVerified', true)
  await wrappedResponse.toHaveProperty('alreadyEnrolled', alreadyEnrolled)

  expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
  expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
  expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
}

const testEnrollmentServiceError = async errorMessage => {
  const onEnrollmentProcessing = jest.fn()
  const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

  await wrappedResponse.toThrow(errorMessage)
  await wrappedResponse.not.toHaveProperty('response')

  expect(onEnrollmentProcessing).not.toHaveBeenCalled()
}

describe('ZoomProvider', () => {
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

  test('issueToken() should return session token', async () => {
    helper.mockSuccessSessionToken(sessionToken)

    await expect(ZoomProvider.issueToken()).resolves.toEqual(sessionToken)
  })

  test('isValid() validates payload if facemap and images are present', () => {
    expect(ZoomProvider.isPayloadValid(payload)).toBeTruthy()
    expect(ZoomProvider.isPayloadValid({})).toBeFalsy()
  })

  test('enroll() returns successfull response if liveness passed, no duplicates found and enrollment was successfull', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)

    await testSuccessfullEnrollment()
  })

  test('enroll() returns successfull response if identifier was alreadsy enrolled', async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)
    helper.mockSuccessLivenessCheck(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)

    await testSuccessfullEnrollment(true)
  })

  test('enroll() throws if liveness check fails', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockFailedEnrollment(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.failedLivenessMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isLive', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: false })
  })

  test('enroll() throws if duplicates found', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockDuplicateFound(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.duplicateFoundMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isDuplicate', true)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: true })
  })

  test('enroll() throws if enroll to 3D Database fails', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentFailed(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.failedEnrollmentMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isEnrolled', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: false })
  })

  test('enroll() throws on any Zoom service error and terminates without returning any response or calling callback', async () => {
    const uri = helper.enrollmentUri(enrollmentIdentifier)

    zoomServiceMock
      .onGet(uri)
      .replyOnce(500)
      .onGet(uri)
      .networkErrorOnce()

    await testEnrollmentServiceError(helper.serviceErrorMessage)
    await testEnrollmentServiceError('Network Error')
  })

  test('isEnrollmentIndexed() checks enrollment existence', async () => {
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
    await expect(ZoomProvider.isEnrollmentIndexed(enrollmentIdentifier)).resolves.toBe(true)
    zoomServiceMock.reset()

    helper.mockEnrollmentNotExistsDuringReadIndex(enrollmentIdentifier)
    await expect(ZoomProvider.isEnrollmentIndexed(enrollmentIdentifier)).resolves.toBe(false)
  })

  test("dispose() removes existing enrollment, doesn't throws for unexisting", async () => {
    helper.mockSuccessRemoveEnrollmentFromIndex(enrollmentIdentifier)
    await expect(ZoomProvider.dispose(enrollmentIdentifier)).resolves.toBeUndefined()
    zoomServiceMock.reset()

    helper.mockEnrollmentNotExistsDuringRemoveFromIndex(enrollmentIdentifier)
    await expect(ZoomProvider.dispose(enrollmentIdentifier)).resolves.toBeUndefined()
  })

  test('dispose() throws on Zoom service error', async () => {
    helper.mockServiceErrorDuringRemoveFromIndex(enrollmentIdentifier)

    await expect(ZoomProvider.dispose(enrollmentIdentifier)).rejects.toThrow(helper.serviceErrorMessage)
  })
})

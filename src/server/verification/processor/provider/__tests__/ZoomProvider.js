// @flow

import MockAdapter from 'axios-mock-adapter'

import ZoomProvider from '../ZoomProvider'
import createMockingHelper from '../../../api/__tests__/__util__'

let helper
let zoomServiceMock

const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: 'fake-session-id',
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE==',
  lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
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

  test('isValid() validates payload if facemap and images are present', () => {
    expect(ZoomProvider.isPayloadValid(payload)).toBeTruthy()
    expect(ZoomProvider.isPayloadValid({})).toBeFalsy()
  })

  test('enroll() returns successfull response if no duplicates found and enrollment was successfull', async () => {
    helper.mockEmptyResultsFaceSearch()
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isEnrolled: true, isLive: true })
  })

  test('enroll() returns successfull response if identifier was alreadsy enrolled', async () => {
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
            enrollmentIdentifier,
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

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isEnrolled: true, isLive: true })
  })

  test('enroll() throws if duplicates found', async () => {
    helper.mockEmptyResultsFaceSearch()
    helper.mockDuplicateFound()

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.duplicateFoundMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isDuplicate', true)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isDuplicate: true })
  })

  test('enroll() throws if liveness check fails', async () => {
    helper.mockEmptyResultsFaceSearch()
    helper.mockFailedEnrollment(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.failedEnrollmentMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isEnrolled', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)
    await wrappedResponse.toHaveProperty('response.isLive', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isEnrolled: false, isLive: false })
  })

  test('enroll() throws on any Zoom service error and terminates without returning any response or calling callback', async () => {
    zoomServiceMock
      .onPost('/search')
      .replyOnce(500)
      .onPost('/search')
      .networkErrorOnce()

    await testEnrollmentServiceError(helper.serviceErrorMessage)
    await testEnrollmentServiceError('Network Error')
  })

  test('enrollmentExists() checks enrollment existence', async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)
    await expect(ZoomProvider.enrollmentExists(enrollmentIdentifier)).resolves.toBe(true)

    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    await expect(ZoomProvider.enrollmentExists(enrollmentIdentifier)).resolves.toBe(false)
  })

  test("dispose() removes existing enrollment, doesn't throws for unexisting", async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)
    await expect(ZoomProvider.dispose(enrollmentIdentifier)).resolves.toBeUndefined()

    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    await expect(ZoomProvider.dispose(enrollmentIdentifier)).resolves.toBeUndefined()
  })

  test('dispose() throws on Zoom service error', async () => {
    helper.mockServiceErrorHappenedWhileDisposing(enrollmentIdentifier)

    await expect(ZoomProvider.dispose(enrollmentIdentifier)).rejects.toThrow(helper.serviceErrorMessage)
  })
})

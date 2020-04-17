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

  test('enroll() returns successfull response if liveness passed, no duplicates and enrollment successfull', async () => {
    helper.mockSuccessLivenessCheck()
    helper.mockEmptyResultsFaceSearch()
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() returns successfull response if identifier was alreadsy enrolled', async () => {
    helper.mockSuccessLivenessCheck()

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

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() throws if liveness check fails', async () => {
    helper.mockFailedLivenessCheck()

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(helper.failedLivenessCheckMessage)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isLive', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: false })
  })

  test('enroll() throws if duplicates found', async () => {
    const duplicateEnrollmentIdentifier = 'another-one-fake-enrollment-identifier'

    helper.mockSuccessLivenessCheck()

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
            enrollmentIdentifier: duplicateEnrollmentIdentifier,
            matchLevel: '1',
            auditTrailImage: 'data:image/png:FaKEimagE=='
          }
        ]
      }
    })

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow(`Duplicate with identifier '${duplicateEnrollmentIdentifier}' found.`)
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isDuplicate', true)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: true })
  })

  test('enroll() throws if enrollment fails in any other case expect alreadyEnrolled', async () => {
    helper.mockSuccessLivenessCheck()
    helper.mockEmptyResultsFaceSearch()
    helper.mockFailedEnrollment(enrollmentIdentifier)

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
    zoomServiceMock
      .onPost('/liveness')
      .replyOnce(500)
      .onPost('/liveness')
      .networkErrorOnce()

    await testEnrollmentServiceError('Request failed with status code 500')
    await testEnrollmentServiceError('Network Error')
  })
})

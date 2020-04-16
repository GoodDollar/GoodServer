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
    // via zoomServiceMock mock:
    // - success liveness check
    // - empty search results
    // - successfull enroll

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() returns successfull response if identifier was alreadsy enrolled', async () => {
    // via zoomServiceMock mock:
    // - success liveness check
    // - search results including enrollmentIdentifier we enrolling
    // - "enrollmentIdentifier exists in database" failed enroll response

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).resolves

    await wrappedResponse.toHaveProperty('isVerified', true)
    await wrappedResponse.toHaveProperty('alreadyEnrolled', true)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(3, { isEnrolled: true })
  })

  test('enroll() throws if liveness check fails', async () => {
    // via zoomServiceMock mock:
    // - "Liveness was unsuccessful" liveness check response

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow('<message from response mocked>')
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isLive', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: false })
  })

  test('enroll() throws if duplicates found', async () => {
    // via zoomServiceMock mock:
    // - success liveness check
    // - non-empty search results without enrollmentIdentifier we enrolling

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow('Duplicate with identifier')
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isDuplicate', true)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: true })
  })

  test('enroll() throws if enrollment fails in any other case expect alreadyEnrolled', async () => {
    // via zoomServiceMock mock:
    // - success liveness check
    // - empty search results
    // - "enrollment failed because Liveness could not be determined" /enrollment response

    const onEnrollmentProcessing = jest.fn()
    const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

    await wrappedResponse.toThrow('<message from failed response mocked>')
    await wrappedResponse.toHaveProperty('response')
    await wrappedResponse.toHaveProperty('response.isEnrolled', false)
    await wrappedResponse.toHaveProperty('response.isVerified', false)

    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(1, { isLive: true })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(onEnrollmentProcessing).toHaveBeenNthCalledWith(2, { isEnrolled: false })
  })

  test('enroll() throws on any Zoom service error and terminates without returning any response or calling callback', async () => {
    zoomServiceMock
      .onPost('/liveness')
      .replyOnce(500)
      .onPost('/liveness')
      .networkErrorOnce()

    for (const message of ['Error: Request failed with status code 500', 'Error: Network Error']) {
      const onEnrollmentProcessing = jest.fn()
      const wrappedResponse = expect(ZoomProvider.enroll(enrollmentIdentifier, payload, onEnrollmentProcessing)).rejects

      await wrappedResponse.toThrow(message) // eslint-disable-line no-await-in-loop
      await wrappedResponse.not.toHaveProperty('response') // eslint-disable-line no-await-in-loop

      expect(onEnrollmentProcessing).not.toHaveBeenCalled()
    }
  })
})

// @flow

import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap } from 'lodash'

import createEnrollmentProcessor from '../EnrollmentProcessor'
import { GunDBPublic } from '../../../gun/gun-middleware'
import AdminWallet from '../../../blockchain/AdminWallet'

const modulesToMock = ['../../../gun/gun-middleware', '../../../blockchain/AdminWallet']

let zoomServiceMock
let enrollmentProcessor

const updateUserMock = jest.fn()
const updateSessionMock = jest.fn()

const enrollmentIdentifier = 'fake-enrollment-identifier'

const payload = {
  sessionId: 'fake-session-id',
  faceMap: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE==',
  lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
}

const user = {
  identifier: 'fake-user-identifier',
  gdAddress: 'fake-wallet-address',
  profilePublickey: 'fake-public-key',
  loggedInAs: 'fake@email.com'
}

describe('EnrollmentProcessor', () => {
  beforeAll(() => {
    modulesToMock.forEach(jest.mock)

    GunDBPublic.session.mockImplementation(() => ({ put: updateSessionMock }))

    enrollmentProcessor = createEnrollmentProcessor({ updateUser: updateUserMock })
    zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
  })

  afterEach(() => {
    invokeMap([updateUserMock, updateSessionMock, GunDBPublic.session, AdminWallet.whitelistUser], 'mockReset')

    zoomServiceMock.reset()
  })

  afterAll(() => {
    modulesToMock.forEach(jest.unmock)

    zoomServiceMock.restore()
    zoomServiceMock = null
  })

  test('validate() passes when all user, enrollmentIdentifier and sessionId are present only', () => {
    expect(() => enrollmentProcessor.validate(user, enrollmentIdentifier, payload)).not.toThrow()
    expect(() => enrollmentProcessor.validate(null, enrollmentIdentifier, payload)).toThrow('Invalid input')
    expect(() => enrollmentProcessor.validate(user, null, payload)).toThrow('Invalid input')
    expect(() => enrollmentProcessor.validate(user, enrollmentIdentifier, omit(payload, 'sessionId'))).toThrow(
      'Invalid input'
    )
  })

  test("enroll() proxies provider's response, updates session and whitelists user on success", async () => {
    // via zoomServiceMock mock:
    // - success liveness check
    // - empty search results
    // - successfull enroll

    const { gdAddress, profilePublickey, loggedInAs } = user
    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(GunDBPublic.session).toBeCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(3, { isDuplicate: false })
    expect(updateSessionMock).toHaveBeenNthCalledWith(4, { isEnrolled: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(5, { isWhitelisted: true })

    expect(updateUserMock).toHaveBeenLastCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(AdminWallet.whitelistUser).toHaveBeenLastCalledWith(gdAddress, profilePublickey)
  })

  test("enroll() proxies provider's error and sets error + non-whitelisted state in the session", async () => {
    // via zoomServiceMock mock:
    // - "Liveness was unsuccessful" liveness check response

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).rejects

    await wrappedResponse.toThrow('<error from response mocked>')
    await wrappedResponse.toHaveProperty('response.success', false)
    await wrappedResponse.toHaveProperty('response.enrollmentResult.isVerified', false)

    expect(GunDBPublic.session).toBeCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: false })

    expect(updateSessionMock).toHaveBeenNthCalledWith(3, {
      isLive: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: '<error from response mocked>'
    })
  })
})

// @flow

import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap } from 'lodash'

import createEnrollmentProcessor from '../EnrollmentProcessor'
import { GunDBPublic } from '../../../gun/gun-middleware'
import AdminWallet from '../../../blockchain/AdminWallet'

import createMockingHelper from '../../api/__tests__/__util__'

let helper
let zoomServiceMock
let enrollmentProcessor

const updateUserMock = jest.fn()
const updateSessionMock = jest.fn()
const whitelistUserMock = jest.fn()
const getSessionRefMock = jest.fn()
const getSessionRefImplementation = GunDBPublic.session

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
    GunDBPublic.session = getSessionRefMock
    AdminWallet.whitelistUser = whitelistUserMock

    enrollmentProcessor = createEnrollmentProcessor({ updateUser: updateUserMock })
    zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  beforeEach(() => {
    getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))
  })

  afterEach(() => {
    invokeMap([updateUserMock, updateSessionMock, getSessionRefMock, whitelistUserMock], 'mockReset')

    zoomServiceMock.reset()
  })

  afterAll(() => {
    GunDBPublic.session = getSessionRefImplementation
    AdminWallet.whitelistUser = AdminWallet.constructor.prototype.whitelistUser

    zoomServiceMock.restore()
    enrollmentProcessor = null
    zoomServiceMock = null
    helper = null
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
    helper.mockSuccessLivenessCheck()
    helper.mockEmptyResultsFaceSearch()
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const { gdAddress, profilePublickey, loggedInAs } = user
    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(getSessionRefMock).toHaveBeenCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(3, { isDuplicate: false })
    expect(updateSessionMock).toHaveBeenNthCalledWith(4, { isEnrolled: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(5, { isWhitelisted: true })

    expect(updateUserMock).toHaveBeenCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(whitelistUserMock).toHaveBeenCalledWith(gdAddress, profilePublickey)
  })

  test("enroll() proxies provider's error and sets error + non-whitelisted state in the session", async () => {
    helper.mockFailedLivenessCheck()

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', false)
    await wrappedResponse.toHaveProperty('error', helper.failedLivenessCheckMessage)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', false)

    expect(getSessionRefMock).toHaveBeenCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: false })

    expect(updateSessionMock).toHaveBeenNthCalledWith(3, {
      isLive: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: helper.failedLivenessCheckMessage
    })
  })
})

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
const hasTasksQueuedMock = jest.fn(() => false)
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

const testValidation = async (validationPromise, errorMessage = 'Invalid input') =>
  expect(validationPromise).rejects.toThrow(errorMessage)

describe('EnrollmentProcessor', () => {
  beforeAll(() => {
    GunDBPublic.session = getSessionRefMock
    AdminWallet.whitelistUser = whitelistUserMock

    enrollmentProcessor = createEnrollmentProcessor({
      updateUser: updateUserMock,
      hasTasksQueued: hasTasksQueuedMock
    })

    zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  beforeEach(() => {
    getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))
  })

  afterEach(() => {
    invokeMap(
      [updateUserMock, updateSessionMock, getSessionRefMock, hasTasksQueuedMock, whitelistUserMock],
      'mockReset'
    )

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

  test('validate() passes when  user, enrollmentIdentifier and sessionId are present', async () => {
    await expect(enrollmentProcessor.validate(user, enrollmentIdentifier, payload)).resolves.toBeUndefined()
  })

  test('validate() fails when if user, enrollmentIdentifier or sessionId are empty', async () => {
    await testValidation(enrollmentProcessor.validate(null, enrollmentIdentifier, payload))
    await testValidation(enrollmentProcessor.validate(user, null, payload))
    await testValidation(enrollmentProcessor.validate(user, enrollmentIdentifier, omit(payload, 'sessionId')))
  })

  test('validate() fails if user is being deleted', async () => {
    hasTasksQueuedMock.mockReturnValueOnce(true)

    await testValidation(
      enrollmentProcessor.validate(user, enrollmentIdentifier, payload),
      'Facemap record with same identifier is being deleted.'
    )
  })

  test("enroll() proxies provider's response, updates session and whitelists user on success", async () => {
    helper.mockEmptyResultsFaceSearch()
    helper.mockSuccessEnrollment(enrollmentIdentifier)

    const { gdAddress, profilePublickey, loggedInAs } = user
    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(getSessionRefMock).toHaveBeenCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isDuplicate: false })
    expect(updateSessionMock).toHaveBeenNthCalledWith(3, { isEnrolled: true, isLive: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(4, { isWhitelisted: true })

    expect(updateUserMock).toHaveBeenCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(whitelistUserMock).toHaveBeenCalledWith(gdAddress, profilePublickey)
  })

  test("enroll() proxies provider's error and sets error + non-whitelisted state in the session", async () => {
    helper.mockDuplicateFound()

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', false)
    await wrappedResponse.toHaveProperty('error', helper.duplicateFoundMessage)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', false)

    expect(getSessionRefMock).toHaveBeenCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isDuplicate: true })

    expect(updateSessionMock).toHaveBeenNthCalledWith(3, {
      isLive: false,
      isDuplicate: true,
      isEnrolled: false,
      isWhitelisted: false,
      isError: helper.duplicateFoundMessage
    })
  })
})

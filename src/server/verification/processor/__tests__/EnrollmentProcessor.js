// @flow

import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap, first } from 'lodash'

import createEnrollmentProcessor, { DISPOSE_ENROLLMENTS_TASK } from '../EnrollmentProcessor'
import { GunDBPublic } from '../../../gun/gun-middleware'
import AdminWallet from '../../../blockchain/AdminWallet'

import createMockingHelper from '../../api/__tests__/__util__'

let helper
let zoomServiceMock
let enrollmentProcessor

// storage mocks
const updateUserMock = jest.fn()
const enqueueTaskMock = jest.fn(async () => {})
const hasTasksQueuedMock = jest.fn(() => false)
const fetchTasksForProcessingMock = jest.fn(async () => {})
const removeDelayedTasksMock = jest.fn(async () => {})
const failDelayedTasksMock = jest.fn(async () => {})

// GUN mocks
const updateSessionMock = jest.fn()
const getSessionRefMock = jest.fn()
const getSessionRefImplementation = GunDBPublic.session

// wallet mocks
const whitelistUserMock = jest.fn()
const removeWhitelistedMock = jest.fn(async () => {})
const isVerifiedMock = jest.fn(async () => false)

const enrollmentIdentifier = 'fake-enrollment-identifier'
const signature =
  '0x04a0b8f3995cf577a408b03fcb206f43c79ae69196f891773c2016dbe9553c775250256bf1d54884519db1343246c8b8fa0aa854d0403ecf740c738f8567579c1b'

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
    enrollmentProcessor.keepEnrollments = 24
  })

  beforeEach(() => {
    getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))
  })

  afterEach(() => {
    invokeMap(
      [
        updateUserMock,
        hasTasksQueuedMock,
        enqueueTaskMock,
        fetchTasksForProcessingMock,
        failDelayedTasksMock,
        removeDelayedTasksMock,

        updateSessionMock,
        getSessionRefMock,

        whitelistUserMock,
        isVerifiedMock,
        removeWhitelistedMock
      ],
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

  test('validate() passes if user, enrollmentIdentifier and sessionId are present', async () => {
    await expect(enrollmentProcessor.validate(user, enrollmentIdentifier, payload)).resolves.toBeUndefined()
  })

  test('validate() fails if user, enrollmentIdentifier or sessionId are empty', async () => {
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

  test('enqueueDisposal() enqueues disposal task', async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, signature)).resolves.toBeUndefined()
    expect(enqueueTaskMock).toHaveBeenCalledWith(DISPOSE_ENROLLMENTS_TASK, enrollmentIdentifier)
  })

  test("enqueueDisposal() de-whitelists user if it's whitelisted", async () => {
    helper.mockEnrollmentFound(enrollmentIdentifier)
    isVerifiedMock.mockResolvedValueOnce(true)

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, signature)).resolves.toBeUndefined()
    expect(removeWhitelistedMock).toHaveBeenCalledWith(user.gdAddress)
  })

  test('enqueueDisposal() disposes enrollment immediately if KEEP_FACE_VERIFICATION_RECORDS = 0', async () => {
    const disposeMock = jest.fn(async () => {})

    helper.mockEnrollmentFound(enrollmentIdentifier)
    enrollmentProcessor.keepEnrollments = 0
    enrollmentProcessor.provider.dispose = disposeMock

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, signature)).resolves.toBeUndefined()
    expect(disposeMock).toHaveBeenCalledWith(enrollmentIdentifier)
  })

  test('enqueueDisposal() fails with invalid signature', async () => {
    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, 'invalid-signature')).rejects.toThrow(
      `Unable to enqueue enrollment disposal: SigUtil unable to recover the message signer`
    )
  })

  test("enqueueDisposal() doesn't enqueues if enrollment isn't exists", async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, signature)).resolves.toBeUndefined()
    expect(enqueueTaskMock).not.toHaveBeenCalled()
  })

  test('disposeEnqueuedEnrollments() calls callback, fails unsuccessfull tasks and removes successfull tasks from queue', async () => {
    const failedEnrollmentIdentifier = 'failed-enrollment-identifier'
    const taskId = identifier => `${identifier}-task-id`
    const onProcessedMock = jest.fn()

    fetchTasksForProcessingMock.mockResolvedValueOnce(
      [failedEnrollmentIdentifier, enrollmentIdentifier].map(identifier => ({
        _id: taskId(identifier),
        subject: identifier
      }))
    )

    helper.mockEnrollmentFound(enrollmentIdentifier)
    helper.mockServiceErrorHappenedWhileDisposing(failedEnrollmentIdentifier)

    await expect(enrollmentProcessor.disposeEnqueuedEnrollments(onProcessedMock)).resolves.toBeUndefined()

    const [firstCallIdentifier, firstCallexpection] = first(onProcessedMock.mock.calls)

    expect(firstCallIdentifier).toBe(failedEnrollmentIdentifier)
    expect(firstCallexpection).toBeInstanceOf(Error)
    expect(firstCallexpection).toHaveProperty('message', helper.serviceErrorMessage)
    expect(onProcessedMock).toHaveBeenLastCalledWith(enrollmentIdentifier)

    expect(failDelayedTasksMock).toHaveBeenCalledWith(taskId(failedEnrollmentIdentifier))
    expect(removeDelayedTasksMock).toHaveBeenCalledWith(taskId(enrollmentIdentifier))
  })
})

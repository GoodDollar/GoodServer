// @flow

import MockAdapter from 'axios-mock-adapter'
import { assign, omit, invokeMap } from 'lodash'

import createEnrollmentProcessor, { DISPOSE_ENROLLMENTS_TASK } from '../EnrollmentProcessor'
import { GunDBPublic } from '../../../gun/gun-middleware'
import AdminWallet from '../../../blockchain/AdminWallet'
import { ClaimQueue } from '../../../claimQueue/claimQueueAPI'

import createMockingHelper from '../../api/__tests__/__util__'

let helper
let zoomServiceMock

// storage mocks
const updateUserMock = jest.fn()
const enqueueTaskMock = jest.fn()
const hasTasksQueuedMock = jest.fn()
const fetchTasksForProcessingMock = jest.fn()
const removeDelayedTasksMock = jest.fn()
const failDelayedTasksMock = jest.fn()

// GUN mocks
const updateSessionMock = jest.fn()
const getSessionRefMock = jest.fn()
const getSessionRefImplementation = GunDBPublic.session
const setWhitelistedImplementation = ClaimQueue.setWhitelisted

// queue mocks
const whitelistInQueueMock = jest.fn()

// wallet mocks
const whitelistUserMock = jest.fn()
const removeWhitelistedMock = jest.fn()
const isVerifiedMock = jest.fn()

const storageMock = {
  updateUser: updateUserMock,
  hasTasksQueued: hasTasksQueuedMock,
  enqueueTask: enqueueTaskMock,
  fetchTasksForProcessing: fetchTasksForProcessingMock,
  removeDelayedTasks: removeDelayedTasksMock,
  failDelayedTasks: failDelayedTasksMock
}

const enrollmentIdentifier = 'f0D7A688489Ab3079491d407A03BF16e5B027b2c'
const signature =
  '0xff612279b69900493cec3e5f8707413ad4734aa1748483b61c856d3093bf0c88458e82722365f35dfedf88438ba1419774bbb67527057d9066eba9a548d4fc751b'

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
  const enrollmentProcessor = createEnrollmentProcessor(storageMock)
  const { keepEnrollments } = enrollmentProcessor

  beforeAll(() => {
    GunDBPublic.session = getSessionRefMock
    AdminWallet.whitelistUser = whitelistUserMock
    AdminWallet.removeWhitelisted = removeWhitelistedMock
    AdminWallet.isVerified = isVerifiedMock
    ClaimQueue.setWhitelisted = whitelistInQueueMock

    zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  beforeEach(() => {
    enrollmentProcessor.keepEnrollments = 24

    isVerifiedMock.mockResolvedValue(false)
    hasTasksQueuedMock.mockReturnValue(false)
    enqueueTaskMock.mockResolvedValue({ _id: 'fake-task-id' })
    getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))

    invokeMap(
      [
        updateUserMock,
        fetchTasksForProcessingMock,
        failDelayedTasksMock,
        removeDelayedTasksMock,

        removeWhitelistedMock
      ],
      'mockResolvedValuw'
    )
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

        whitelistInQueueMock,

        whitelistUserMock,
        isVerifiedMock,
        removeWhitelistedMock
      ],
      'mockReset'
    )

    zoomServiceMock.reset()
    zoomServiceMock.resetHistory()
  })

  afterAll(() => {
    const restoreWalletMethods = ['whitelistUser', 'removeWhitelisted', 'isVerified']

    GunDBPublic.session = getSessionRefImplementation
    ClaimQueue.whitelistUser = setWhitelistedImplementation
    restoreWalletMethods.forEach(method => (AdminWallet[method] = AdminWallet.constructor.prototype[method]))

    assign(enrollmentProcessor, { keepEnrollments })
    zoomServiceMock.restore()
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

  test('isEnqueuedForDisposal() checks is user being deleted', async () => {
    hasTasksQueuedMock.mockReturnValueOnce(true)
    await expect(enrollmentProcessor.isEnqueuedForDisposal(enrollmentIdentifier)).resolves.toBeTrue()

    hasTasksQueuedMock.mockReturnValueOnce(false)
    await expect(enrollmentProcessor.isEnqueuedForDisposal(enrollmentIdentifier)).resolves.toBeFalse()
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
    expect(whitelistInQueueMock).toHaveBeenCalledWith(user, storageMock, expect.anything())
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
    helper.mockEnrollmentFound(enrollmentIdentifier)
    enrollmentProcessor.keepEnrollments = 0

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier, signature)).resolves.toBeUndefined()

    const [disposeRequest] = zoomServiceMock.history.delete

    expect(disposeRequest).toBeDefined()
    expect(disposeRequest.url).toBe(helper.enrollmentUri(enrollmentIdentifier))
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

    expect(onProcessedMock).toHaveBeenCalledWith(enrollmentIdentifier)
    expect(onProcessedMock).toHaveBeenCalledWith(failedEnrollmentIdentifier, expect.any(Error))
    expect(onProcessedMock).toHaveBeenCalledWith(
      failedEnrollmentIdentifier,
      expect.objectContaining({ message: helper.serviceErrorMessage })
    )

    expect(failDelayedTasksMock).toHaveBeenCalledWith([taskId(failedEnrollmentIdentifier)])
    expect(removeDelayedTasksMock).toHaveBeenCalledWith([taskId(enrollmentIdentifier)])
  })
})

// @flow

import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap, map } from 'lodash'
import { ZoomLicenseType } from '../../../verification/utils/constants'
import createEnrollmentProcessor from '../EnrollmentProcessor'
import AdminWallet from '../../../blockchain/MultiWallet'
import OnGage from '../../../crm/ongage'

import createMockingHelper from '../../api/__tests__/__util__'
import { createTaskSubject, DisposeAt, DISPOSE_ENROLLMENTS_TASK, forEnrollment } from '../../cron/taskUtil'
import { noopAsync } from '../../../utils/async'

let helper
let zoomServiceMock

// storage mocks
const updateUserMock = jest.fn()
const enqueueTaskMock = jest.fn()
const hasTasksQueuedMock = jest.fn()
const failDelayedTasksMock = jest.fn()
const completeDelayedTasksMock = jest.fn()
const cancelTasksQueuedMock = jest.fn()
const removeDelayedTasksMock = jest.fn()
const fetchTasksForProcessingMock = jest.fn()
const unlockDelayedTasksMock = jest.fn()
const topWalletMock = jest.fn()

// wallet mocks
const whitelistUserMock = jest.fn()
const whitelistContactMock = jest.fn()
const removeWhitelistedMock = jest.fn()
const isVerifiedMock = jest.fn()
const getAuthenticationPeriodMock = jest.fn()

const storageMock = {
  updateUser: updateUserMock,
  hasTasksQueued: hasTasksQueuedMock,
  enqueueTask: enqueueTaskMock,
  fetchTasksForProcessing: fetchTasksForProcessingMock,
  removeDelayedTasks: removeDelayedTasksMock,
  unlockDelayedTasks: unlockDelayedTasksMock,
  failDelayedTasks: failDelayedTasksMock,
  completeDelayedTasks: completeDelayedTasksMock,
  cancelTasksQueued: cancelTasksQueuedMock
}

const fakeTask = { _id: 'fake-task-id' }
const enrollmentIdentifier = 'f0D7A688489Ab3079491d407A03BF16e5B027b2c'
const licenseKey = 'fake-license'
const licenseType = ZoomLicenseType.Browser

const payload = {
  sessionId: 'fake-session-id',
  faceScan: Buffer.alloc(32),
  auditTrailImage: 'data:image/png:FaKEimagE==',
  lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
}

const user = {
  identifier: 'fake-user-identifier',
  gdAddress: 'fake-wallet-address',
  profilePublickey: 'fake-public-key',
  loggedInAs: 'fake@email.com',
  crmId: 'fake-crm-id'
}

const testValidation = async (validationPromise, errorMessage = 'Invalid input') =>
  expect(validationPromise).rejects.toThrow(errorMessage)

describe('EnrollmentProcessor', () => {
  const enrollmentProcessor = createEnrollmentProcessor(storageMock)

  beforeAll(() => {
    AdminWallet.whitelistUser = whitelistUserMock
    AdminWallet.removeWhitelisted = removeWhitelistedMock
    AdminWallet.isVerified = isVerifiedMock
    AdminWallet.getAuthenticationPeriod = getAuthenticationPeriodMock
    AdminWallet.topWallet = topWalletMock
    OnGage.setWhitelisted = whitelistContactMock

    zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    helper = createMockingHelper(zoomServiceMock)
  })

  beforeEach(() => {
    isVerifiedMock.mockResolvedValue(false)
    hasTasksQueuedMock.mockReturnValue(false)
    enqueueTaskMock.mockResolvedValue(fakeTask)
    getAuthenticationPeriodMock.mockReturnValue(14)
    unlockDelayedTasksMock.mockImplementation(noopAsync)
    whitelistUserMock.mockImplementation(noopAsync)
    whitelistContactMock.mockImplementation(noopAsync)
    topWalletMock.mockImplementation(noopAsync)
    fetchTasksForProcessingMock.mockResolvedValue(() => Promise.resolve())

    invokeMap(
      [
        updateUserMock,
        failDelayedTasksMock,
        completeDelayedTasksMock,
        removeDelayedTasksMock,
        topWalletMock,
        removeWhitelistedMock
      ],
      'mockResolvedValue'
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
        completeDelayedTasksMock,
        cancelTasksQueuedMock,
        whitelistUserMock,
        whitelistContactMock,
        isVerifiedMock,
        getAuthenticationPeriodMock,
        removeWhitelistedMock,
        topWalletMock
      ],
      'mockReset'
    )

    zoomServiceMock.reset()
  })

  afterAll(() => {
    const restoreWalletMethods = ['whitelistUser', 'removeWhitelisted', 'isVerified', 'topWallet']

    restoreWalletMethods.forEach(method => (AdminWallet[method] = AdminWallet.constructor.prototype[method]))
    OnGage.setWhitelisted = OnGage.constructor.prototype.setWhitelisted

    zoomServiceMock.restore()
    zoomServiceMock = null
    helper = null
  })

  test('getLicenseKey() passes validation and returns license key', async () => {
    helper.mockSuccessLicenseKey(licenseType, licenseKey)

    await expect(enrollmentProcessor.getLicenseKey(licenseType)).resolves.toEqual(licenseKey)
  })

  test('getLicenseKey() fails if invalid license type passed', async () => {
    await testValidation(enrollmentProcessor.getLicenseKey('unknown'))
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

  test("enroll() proxies provider's response and whitelists user on success", async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)

    const { gdAddress, loggedInAs, profilePublickey, crmId } = user
    user.chainId = 1234

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(updateUserMock).toHaveBeenCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(whitelistUserMock).toHaveBeenCalledWith(gdAddress, profilePublickey, 1234, expect.anything())
    expect(topWalletMock).toHaveBeenCalledWith(gdAddress, 'all', expect.anything())
    expect(whitelistContactMock.mock.calls[0][0]).toBe(crmId)
  })

  test("enroll() proxies provider's response and whitelists user with chainId on success", async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)

    const { gdAddress, loggedInAs, profilePublickey, crmId } = user
    user.chainId = 1234
    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(updateUserMock).toHaveBeenCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(whitelistUserMock).toHaveBeenCalledWith(gdAddress, profilePublickey, 1234, expect.anything())
    expect(topWalletMock).toHaveBeenCalledWith(gdAddress, 'all', expect.anything())
    expect(whitelistContactMock.mock.calls[0][0]).toBe(crmId)
  })

  test('enroll() enqueues task to auto dispose enrollment once auth period passed on success', async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
    helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)

    await enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)

    const subject = createTaskSubject(enrollmentIdentifier, DisposeAt.Reauthenticate)

    expect(enqueueTaskMock).toHaveBeenCalledWith(DISPOSE_ENROLLMENTS_TASK, subject)
  })

  test('enroll() preserves existing tasks for identifier being enrolled', async () => {
    // success always re-creates the task so we'll reproduce the failed case
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockDuplicateFound(enrollmentIdentifier)

    await enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)

    // check for lock called
    expect(fetchTasksForProcessingMock).toHaveBeenCalledWith(
      DISPOSE_ENROLLMENTS_TASK,
      forEnrollment(enrollmentIdentifier)
    )
    // check for unlock called
    expect(unlockDelayedTasksMock).toHaveBeenCalledWith(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentIdentifier))
  })

  test("enroll() proxies provider's error", async () => {
    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockDuplicateFound(enrollmentIdentifier)

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', false)
    await wrappedResponse.toHaveProperty('error', helper.duplicateFoundMessage)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', false)
  })

  test("enroll() catches unexpected provider's error", async () => {
    const unexpectedError = 'Unexpected error during search'

    helper.mockEnrollmentNotFound(enrollmentIdentifier)
    helper.mockSuccessEnrollment(enrollmentIdentifier)
    helper.mockFailedSearch(enrollmentIdentifier, unexpectedError)

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toHaveProperty('success', false)
    await wrappedResponse.toHaveProperty('error', unexpectedError)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', false)
  })

  test('enqueueDisposal() enqueues disposal task', async () => {
    isVerifiedMock.mockReset()
    isVerifiedMock.mockResolvedValue(true)

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier)).resolves.toBeUndefined()

    const subject = createTaskSubject(enrollmentIdentifier, DisposeAt.AccountRemoved)

    expect(enqueueTaskMock).toHaveBeenCalledWith(DISPOSE_ENROLLMENTS_TASK, subject)
  })

  test("enqueueDisposal() de-whitelists user if it's whitelisted", async () => {
    isVerifiedMock.mockResolvedValueOnce(true)

    await expect(enrollmentProcessor.enqueueDisposal(user, enrollmentIdentifier)).resolves.toBeUndefined()
    expect(removeWhitelistedMock).toHaveBeenCalledWith(user.gdAddress)
  })

  test('disposeEnqueuedEnrollments() calls callback, fails unsuccessfull tasks and removes successfull tasks from queue', async () => {
    const nonIndexedEnrollmentIdentifier = 'non-indexed-enrollment-identifier'
    const unexistingEnrollmentIdentifier = 'unexisting-enrollment-identifier'
    const failedEnrollmentIdentifier = 'failed-enrollment-identifier'
    const taskId = identifier => `${identifier}-task-id`
    const onProcessedMock = jest.fn()

    const onceIterator = jest.fn().mockResolvedValueOnce(
      [
        nonIndexedEnrollmentIdentifier,
        unexistingEnrollmentIdentifier,
        failedEnrollmentIdentifier,
        enrollmentIdentifier
      ].map(identifier => ({
        _id: taskId(identifier),
        subject: { enrollmentIdentifier: identifier, executeAt: DisposeAt.AccountRemoved }
      }))
    )
    fetchTasksForProcessingMock.mockResolvedValueOnce(() => onceIterator())

    helper.mockEnrollmentFound(enrollmentIdentifier)
    helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
    helper.mockSuccessRemoveEnrollmentFromIndex(enrollmentIdentifier)
    helper.mockRemoveEnrollmentNotSupported(enrollmentIdentifier)

    helper.mockEnrollmentFound(nonIndexedEnrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringReadIndex(nonIndexedEnrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringRemoveFromIndex(nonIndexedEnrollmentIdentifier)
    helper.mockRemoveEnrollmentNotSupported(nonIndexedEnrollmentIdentifier)

    helper.mockEnrollmentFound(failedEnrollmentIdentifier)
    helper.mockSuccessReadEnrollmentIndex(failedEnrollmentIdentifier)
    helper.mockServiceErrorDuringRemoveFromIndex(failedEnrollmentIdentifier)
    helper.mockRemoveEnrollmentNotSupported(failedEnrollmentIdentifier)

    helper.mockEnrollmentNotFound(unexistingEnrollmentIdentifier)
    helper.mockEnrollmentNotExistsDuringReadIndex(unexistingEnrollmentIdentifier)

    await expect(enrollmentProcessor.disposeEnqueuedEnrollments(onProcessedMock)).resolves.toBeUndefined()

    const { delete: deleteHistory } = zoomServiceMock.history

    expect(map(deleteHistory, 'url')).toEqual(
      expect.arrayContaining([nonIndexedEnrollmentIdentifier, enrollmentIdentifier].map(helper.enrollmentUri))
    )

    expect(onProcessedMock).toHaveBeenCalledWith(enrollmentIdentifier)
    expect(onProcessedMock).toHaveBeenCalledWith(unexistingEnrollmentIdentifier)
    expect(onProcessedMock).toHaveBeenCalledWith(nonIndexedEnrollmentIdentifier)
    expect(onProcessedMock).toHaveBeenCalledWith(failedEnrollmentIdentifier, expect.any(Error))

    expect(getAuthenticationPeriodMock).toHaveBeenCalledTimes(1)
    expect(failDelayedTasksMock).toHaveBeenCalledWith([taskId(failedEnrollmentIdentifier)])

    expect(onProcessedMock).toHaveBeenCalledWith(
      failedEnrollmentIdentifier,
      expect.objectContaining({ message: helper.serviceErrorMessage })
    )

    expect(completeDelayedTasksMock).toHaveBeenCalledWith(
      [unexistingEnrollmentIdentifier, enrollmentIdentifier, nonIndexedEnrollmentIdentifier].map(taskId)
    )
  })
})

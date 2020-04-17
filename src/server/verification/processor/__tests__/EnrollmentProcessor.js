// @flow

import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap } from 'lodash'

import createEnrollmentProcessor from '../EnrollmentProcessor'
import { GunDBPublic } from '../../../gun/gun-middleware'
import AdminWallet from '../../../blockchain/AdminWallet'

let zoomServiceMock
let enrollmentProcessor

const updateUserMock = jest.fn()
const updateSessionMock = jest.fn()
const whitelistUserMock = jest.fn()
const getSessionRefMock = jest.fn(() => ({ put: updateSessionMock }))
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
  })

  afterEach(() => {
    invokeMap([updateUserMock, updateSessionMock, getSessionRefMock, whitelistUserMock], 'mockReset')

    zoomServiceMock.reset()
  })

  afterAll(() => {
    GunDBPublic.session = getSessionRefImplementation
    AdminWallet.whitelistUser = AdminWallet.prototype.whitelistUser

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
    zoomServiceMock.onPost('/liveness').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The FaceTec 3D FaceMap evaluated and Liveness was proven.'
      },
      data: {
        glasses: false,
        isLowQuality: false,
        isReplayFaceMap: true,
        livenessStatus: 0
      }
    })

    zoomServiceMock.onPost('/search').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The search request was processed successfully.'
      },
      data: {
        results: [],
        sourceFaceMap: {
          isReplayFaceMap: false
        }
      }
    })

    zoomServiceMock.onPost('/enrollment').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: 'The FaceMap was successfully enrolled.'
      },
      data: {
        auditTrailVerificationMessage: '...',
        auditTrailVerificationStatus: 0,
        createdDate: '2019-09-16T17:30:40+00:00',
        enrollmentIdentifier,
        errorMessageFromZoomServer: null,
        errorStatusFromZoomServer: 0,
        faceMapType: 0,
        glasses: false,
        isEnrolled: true,
        isLowQuality: false,
        isReplayFaceMap: false,
        livenessStatus: 0
      }
    })

    const { gdAddress, profilePublickey, loggedInAs } = user
    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).resolves

    await wrappedResponse.toBeDefined()
    await wrappedResponse.toHaveProperty('success', true)
    await wrappedResponse.toHaveProperty('enrollmentResult.isVerified', true)

    expect(getSessionRefMock).toBeCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(3, { isDuplicate: false })
    expect(updateSessionMock).toHaveBeenNthCalledWith(4, { isEnrolled: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(5, { isWhitelisted: true })

    expect(updateUserMock).toHaveBeenLastCalledWith({ identifier: loggedInAs, isVerified: true })
    expect(whitelistUserMock).toHaveBeenLastCalledWith(gdAddress, profilePublickey)
  })

  test("enroll() proxies provider's error and sets error + non-whitelisted state in the session", async () => {
    const failedLivenessCheckMessage =
      'Liveness was not processed. This occurs when processing ZoOm 2D FaceMaps because they do not have enough data to determine Liveness.'

    zoomServiceMock.onPost('/liveness').reply(200, {
      meta: {
        ok: true,
        code: 200,
        mode: 'dev',
        message: failedLivenessCheckMessage
      },
      data: {
        glasses: false,
        isLowQuality: false,
        isReplayFaceMap: true,
        livenessStatus: 2
      }
    })

    const wrappedResponse = expect(enrollmentProcessor.enroll(user, enrollmentIdentifier, payload)).rejects

    await wrappedResponse.toThrow(failedLivenessCheckMessage)
    await wrappedResponse.toHaveProperty('response.success', false)
    await wrappedResponse.toHaveProperty('response.enrollmentResult.isVerified', false)

    expect(getSessionRefMock).toBeCalledWith(payload.sessionId)
    expect(updateSessionMock).toHaveBeenNthCalledWith(1, { isStarted: true })
    expect(updateSessionMock).toHaveBeenNthCalledWith(2, { isLive: false })

    expect(updateSessionMock).toHaveBeenNthCalledWith(3, {
      isLive: false,
      isDuplicate: true,
      isWhitelisted: false,
      isError: failedLivenessCheckMessage
    })
  })
})

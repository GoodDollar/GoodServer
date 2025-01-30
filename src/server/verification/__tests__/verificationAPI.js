import request from 'supertest'
import MockAdapter from 'axios-mock-adapter'

import { assign, omit } from 'lodash'
import moment from 'moment'
import Config from '../../server.config'

import storage from '../../db/mongo/user-privat-provider'
import AdminWallet from '../../blockchain/MultiWallet'

import makeServer from '../../server-test'
import { noopAsync } from '../../utils/async'

import { ZoomLicenseType } from '../../verification/utils/constants'
import createEnrollmentProcessor from '../processor/EnrollmentProcessor'
import { getToken, getCreds } from '../../__util__/'
import createMockingHelper from '../api/__tests__/__util__'

import { DisposeAt, scheduleDisposalTask, forEnrollment } from '../cron/taskUtil'

describe('verificationAPI', () => {
  let server
  const { skipEmailVerification, zoomProductionMode, defaultWhitelistChainId } = Config
  const userIdentifier = '0x7ac080f6607405705aed79675789701a48c76f55'

  beforeAll(async () => {
    // enable E-Mail verification
    Config.skipEmailVerification = false

    jest.setTimeout(50000)
    server = await makeServer()

    console.log('verificationAPI: server ready')
    console.log({ server })
  })

  beforeEach(() => {
    Object.assign(Config, { zoomProductionMode })
  })

  afterAll(async () => {
    // restore original config
    Object.assign(Config, { skipEmailVerification, zoomProductionMode })
    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    await new Promise(res =>
      server.close(err => {
        console.log('verificationAPI: closing server', { err })
        res()
      })
    )
  })

  describe('face verification', () => {
    let token
    let helper
    let zoomServiceMock
    let v2Creds
    let v2Token
    const enrollmentProcessor = createEnrollmentProcessor(storage)
    const { keepEnrollments } = enrollmentProcessor

    // wallet mocks
    const whitelistUserMock = jest.fn()
    const removeWhitelistedMock = jest.fn()
    const topWalletMock = jest.fn()
    const isVerifiedMock = jest.fn()
    const lastAuthenticatedMock = jest.fn()
    const getAuthenticationPeriodMock = jest.fn()

    const licenseKey = 'fake-license'
    const licenseType = ZoomLicenseType.Browser
    const sessionToken = 'fake-session-id'
    const enrollmentResultBlob = 'FaKEresULtBloB=='
    const enrollmentIdentifier = 'f0D7A688489Ab3079491d407A03BF16e5B027b2c'
    const signature =
      '0xff612279b69900493cec3e5f8707413ad4734aa1748483b61c856d3093bf0c88458e82722365f35dfedf88438ba1419774bbb67527057d9066eba9a548d4fc751b'

    const baseUri = '/verify/face'
    const sessionUri = baseUri + '/session'
    const enrollmentUri = baseUri + '/' + encodeURIComponent(enrollmentIdentifier)
    const licenseUri = (type = licenseType) => baseUri + helper.licenseUri(type)

    const payload = {
      sessionId: sessionToken,
      faceScan: Buffer.alloc(32),
      auditTrailImage: 'data:image/png:FaKEimagE==',
      lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
    }

    const mockSuccessVerification = (resultBlob = null) => {
      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockSuccessEnrollment(enrollmentIdentifier, resultBlob)
      helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)
      helper.mock3dDatabaseEnrollmentSuccess(enrollmentIdentifier)
    }

    const testInvalidInput = async withoutField =>
      request(server)
        .put(enrollmentUri)
        .send(omit(payload, withoutField))
        .set('Authorization', `Bearer ${token}`)
        .expect(400, { success: false, error: 'Invalid input' })

    // eslint-disable-next-line require-await
    const testVerificationSuccessfull = async (alreadyEnrolled = false, resultBlob = null, alreadyIndexed = false) => {
      const enrollmentResult = {
        alreadyEnrolled,
        alreadyIndexed,
        isVerified: true,
        message: `The FaceMap was ${alreadyEnrolled ? 'already' : 'successfully'} enrolled.`
      }

      if (resultBlob) {
        assign(enrollmentResult, { resultBlob })
      }

      return request(server).put(enrollmentUri).send(payload).set('Authorization', `Bearer ${token}`).expect(200, {
        success: true,
        enrollmentResult
      })
    }

    const testDisposalState = async isDisposing => {
      await request(server)
        .get(enrollmentUri)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, isDisposing })
    }

    const testWhitelisted = async () => {
      const { address, profilePublickey } = await getCreds()
      const lcAddress = address.toLowerCase()

      // checking is user was actrally re-whitelisted in the wallet
      expect(whitelistUserMock).toHaveBeenCalledWith(
        lcAddress,
        profilePublickey,
        defaultWhitelistChainId,
        expect.anything()
      )

      expect(topWalletMock).toHaveBeenCalledWith(lcAddress, 'all', expect.anything())
    }

    const testNotVerified = async () => {
      // to check that user hasn't been updated nowhere:
      // in the database
      const { isVerified } = await storage.getUser(userIdentifier)

      expect(isVerified).toBeFalsy()
      // and in the wallet
      expect(whitelistUserMock).not.toHaveBeenCalled()
      expect(topWalletMock).not.toHaveBeenCalled()
    }

    const mockWhitelisted = () => {
      isVerifiedMock.mockReset()
      isVerifiedMock.mockResolvedValue(true)
    }

    beforeAll(async () => {
      AdminWallet.whitelistUser = whitelistUserMock
      AdminWallet.topWallet = topWalletMock
      AdminWallet.isVerified = isVerifiedMock
      AdminWallet.removeWhitelisted = removeWhitelistedMock
      AdminWallet.lastAuthenticated = lastAuthenticatedMock
      AdminWallet.getAuthenticationPeriod = getAuthenticationPeriodMock

      await storage.deleteUser({ identifier: userIdentifier })
      await storage.addUser({ identifier: userIdentifier })

      zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
      helper = createMockingHelper(zoomServiceMock)
      v2Creds = await getCreds(true)
      token = await getToken(server)
      await storage.addUser({ identifier: v2Creds.address })
      v2Token = await getToken(server, v2Creds)
    })

    beforeEach(async () => {
      await storage.updateUser({ identifier: userIdentifier, gdAddress: userIdentifier, isVerified: false })
      await storage.taskModel.deleteMany(forEnrollment(enrollmentIdentifier))

      enrollmentProcessor.keepEnrollments = 24
      isVerifiedMock.mockResolvedValue(false)
      whitelistUserMock.mockImplementation(noopAsync)
      topWalletMock.mockImplementation(noopAsync)
      removeWhitelistedMock.mockImplementation(noopAsync)
      lastAuthenticatedMock.mockResolvedValue(0)
      getAuthenticationPeriodMock.mockResolvedValue(180)
    })

    afterEach(() => {
      whitelistUserMock.mockReset()
      topWalletMock.mockReset()
      removeWhitelistedMock.mockReset()
      zoomServiceMock.reset()
    })

    afterAll(() => {
      const restoreWalletMethods = ['whitelistUser', 'isVerified', 'topWallet', 'removeWhitelisted']

      restoreWalletMethods.forEach(method => (AdminWallet[method] = AdminWallet.constructor.prototype[method]))

      assign(enrollmentProcessor, { keepEnrollments })
      zoomServiceMock.restore()
      zoomServiceMock = null
      helper = null
    })

    test('Face verification endpoints returns 401 without credentials', async () => {
      await request(server).post(licenseUri()).send({}).expect(401)

      await request(server).post(sessionUri).send({}).expect(401)

      await request(server).put(enrollmentUri).send(payload).expect(401)

      await request(server).get(enrollmentUri).expect(401)

      await request(server).delete(enrollmentUri).expect(401)
    })

    test('POST /verify/face/license/:licenseType returns 200, success: true and license', async () => {
      Config.zoomProductionMode = true
      helper.mockSuccessLicenseKey(licenseType, licenseKey)

      await request(server).post(licenseUri()).send({}).set('Authorization', `Bearer ${token}`).expect(200, {
        success: true,
        license: licenseKey
      })
    })

    test('POST /verify/face/license/:licenseType returns 400, success: false if Zoom API fails', async () => {
      const message = 'No license found in the database for this platformID.'

      Config.zoomProductionMode = true
      helper.mockFailedLicenseKey(licenseType, message)

      await request(server).post(licenseUri()).send({}).set('Authorization', `Bearer ${token}`).expect(400, {
        success: false,
        error: message
      })
    })

    test("POST /verify/face/license/:licenseType returns 400, success: false when license type isn't valid", async () => {
      Config.zoomProductionMode = true

      await request(server).post(licenseUri('unknown')).send({}).set('Authorization', `Bearer ${token}`).expect(400, {
        success: false,
        error: 'Invalid input'
      })
    })

    test('POST /verify/face/license/:licenseType executes in production mode only', async () => {
      await request(server).post(licenseUri()).send({}).set('Authorization', `Bearer ${token}`).expect(400, {
        success: false,
        error: 'Cannot obtain production license running non-production mode.'
      })
    })

    test('POST /verify/face/session returns 200, success: true and sessionToken', async () => {
      helper.mockSuccessSessionToken(sessionToken)

      await request(server).post(sessionUri).send({}).set('Authorization', `Bearer ${token}`).expect(200, {
        success: true,
        sessionToken
      })
    })

    test('POST /verify/face/session returns 400, success: false if Zoom API fails', async () => {
      const message = 'FaceTec API response is empty'

      helper.mockFailedSessionToken(message)

      await request(server).post(sessionUri).send({}).set('Authorization', `Bearer ${token}`).expect(400, {
        success: false,
        error: message
      })
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 when payload is invalid', async () => {
      await testInvalidInput('sessionId') // no sessionId
      await testInvalidInput('faceScan') // no face map
      await testInvalidInput('auditTrailImage') // no face photoshoots
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 if user is being deleted', async () => {
      await scheduleDisposalTask(storage, enrollmentIdentifier, DisposeAt.AccountRemoved)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(400, { success: false, error: 'Facemap record with same identifier is being deleted.' })
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 200 and success: true when verification was successfull', async () => {
      mockSuccessVerification()

      await testVerificationSuccessfull()

      const { isVerified } = await storage.getUser(userIdentifier)

      // to check has user been updated in the database
      expect(isVerified).toBeTruthy()
      // and in the wallet
      await testWhitelisted()
    })

    test('PUT /verify/face/:enrollmentIdentifier returns resultBlob', async () => {
      mockSuccessVerification(enrollmentResultBlob)
      await testVerificationSuccessfull(false, enrollmentResultBlob)
    })

    test("PUT /verify/face/:enrollmentIdentifier returns 200 and success: false when verification wasn't successfull", async () => {
      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockFailedEnrollment(enrollmentIdentifier)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: false,
          error: helper.failedLivenessMessage,
          enrollmentResult: {
            isVerified: false,
            isLive: false,
            success: false,
            error: false,
            externalDatabaseRefID: enrollmentIdentifier,
            faceScanSecurityChecks: {
              replayCheckSucceeded: true,
              sessionTokenCheckSucceeded: true,
              auditTrailVerificationCheckSucceeded: true,
              faceScanLivenessCheckSucceeded: false
            }
          }
        })

      await testNotVerified()
    })

    test("PUT /verify/face/:enrollmentIdentifier returns duplicate's data", async () => {
      const mock = jest.spyOn(storage, 'getTask')
      const today = moment()
      mock.mockResolvedValue({ createdAt: today.toISOString() })
      const expiration = today.add((await AdminWallet.getAuthenticationPeriod()) + 1, 'day').toISOString()

      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockSuccessEnrollment(enrollmentIdentifier)
      helper.mockDuplicateFound(enrollmentIdentifier)
      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: false,
          error: helper.duplicateFoundMessage,
          enrollmentResult: {
            success: true,
            error: false,
            isDuplicate: true,
            duplicate: {
              identifier: helper.duplicateEnrollmentIdentifier,
              matchLevel: 10,
              expiration
            },
            isVerified: false
          }
        })

      await testNotVerified()
      mock.mockRestore()
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 200 and success: false when unexpected error happens', async () => {
      const unexpectedError = 'Unexpected error during search'

      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockSuccessEnrollment(enrollmentIdentifier)
      helper.mockFailedSearch(enrollmentIdentifier, unexpectedError)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: false,
          error: unexpectedError,
          enrollmentResult: {
            error: true,
            success: false,
            isVerified: false,
            errorMessage: unexpectedError
          }
        })

      await testNotVerified()
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 200 and success: false when under age', async () => {
      const unexpectedError = 'age check failed'

      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockSuccessEnrollmentUnderAge(enrollmentIdentifier)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: false,
          error: unexpectedError,
          enrollmentResult: {
            isVerified: false,
            isUnderAge: true
          }
        })

      await testNotVerified()
    })

    test('PUT /verify/face/:enrollmentIdentifier passes full verification flow even if user was already verified', async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: true })

      helper.mockEnrollmentFound(enrollmentIdentifier)
      helper.mockSuccessReadEnrollmentIndex(enrollmentIdentifier)
      helper.mockSuccessUpdateEnrollment(enrollmentIdentifier)
      helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)

      await testVerificationSuccessfull(true, null, true)
      await testWhitelisted()
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 200, success = true and returns future deletion date', async () => {
      mockWhitelisted()
      helper.mockEnrollmentFound(enrollmentIdentifier)
      const mock = jest.spyOn(storage, 'getTask')
      const today = moment()
      mock.mockResolvedValue({ createdAt: today.toISOString(), status: 'pending' })
      const expiration = today.add((await AdminWallet.getAuthenticationPeriod()) + 1, 'day').toISOString()

      await request(server)
        .delete(enrollmentUri)
        .query({ fvSigner: '0x' + enrollmentIdentifier })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, executeAt: expiration, status: 'pending' })

      // const filters = forEnrollment(enrollmentIdentifier, DisposeAt.AccountRemoved)

      // await expect(storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, filters)).resolves.toBe(true)
      mock.mockRestore()
    })

    test("DELETE /verify/face/:enrollmentIdentifier returns 200, success = true and status: complete if user isn't whitelisted", async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)
      const mock = jest.spyOn(storage, 'getTask')
      mock.mockResolvedValue(null)
      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          status: 'complete'
        })
      mock.mockRestore()
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 200, success = true and status: complete if user already expired', async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)
      const mock = jest.spyOn(storage, 'getTask')
      mock.mockResolvedValue({ status: 'complete' })
      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          status: 'complete'
        })
      mock.mockRestore()
    })

    // no longer relevant when just returning expiration
    test.skip('DELETE /verify/face/:enrollmentIdentifier returns 400 and success = false if signature is invalid', async () => {
      const fakeCreds = await getCreds(true)
      const result = await request(server)
        .delete(baseUri + '/' + encodeURIComponent(fakeCreds.fvV2Identifier))
        .query()
        .set('Authorization', `Bearer ${v2Token}`)
        .expect(400)

      expect(result.body.success).toEqual(false)
      expect(result.body.error).toStartWith('FV identifier signature verification faild')
    })

    test.skip('DELETE /verify/face/:enrollmentIdentifier returns 200 and success = true if v2 signature is valid', async () => {
      helper.mockEnrollmentFound(v2Creds.fvV2Identifier.slice(0, 42))

      await request(server)
        .delete(baseUri + '/' + encodeURIComponent(v2Creds.fvV2Identifier))
        .query()
        .set('Authorization', `Bearer ${v2Token}`)
        .expect(200, {
          success: true
        })
    })

    test("GET /verify/face/:enrollmentIdentifier returns isDisposing = false if face snapshot hasn't been enqueued yet for the disposal", async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)
      await testDisposalState(false)
    })

    // no longer valid when cant delete until expiration
    test.skip('GET /verify/face/:enrollmentIdentifier returns isDisposing = true if face snapshot has been enqueued for the disposal', async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)
      mockWhitelisted()

      await request(server).delete(enrollmentUri).query({ signature }).set('Authorization', `Bearer ${token}`)

      await testDisposalState(true)
    })
  })
})

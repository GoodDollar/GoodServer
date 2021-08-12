import request from 'supertest'
import MockAdapter from 'axios-mock-adapter'

import { assign, omit } from 'lodash'
import Config from '../../server.config'

import storage from '../../db/mongo/user-privat-provider'
import AdminWallet from '../../blockchain/AdminWallet'

import makeServer from '../../server-test'
import { delay } from '../../utils/timeout'

import { ZoomLicenseType } from '../../verification/utils/constants'
import createEnrollmentProcessor from '../processor/EnrollmentProcessor'
import { getToken, getCreds } from '../../__util__/'
import createMockingHelper from '../api/__tests__/__util__'

import * as awsSes from '../../aws-ses/aws-ses'
import { DisposeAt, scheduleDisposalTask, DISPOSE_ENROLLMENTS_TASK, forEnrollment } from '../cron/taskUtil'
import { noopAsync } from '../../utils/async'

describe('verificationAPI', () => {
  let server
  const { skipEmailVerification, zoomProductionMode } = Config
  const userIdentifier = '0x7ac080f6607405705aed79675789701a48c76f55'

  beforeAll(async done => {
    // enable E-Mail verification
    Config.skipEmailVerification = false

    jest.setTimeout(50000)
    server = await makeServer(done)

    console.log('verificationAPI: server ready')
    console.log({ server })
  })

  beforeEach(() => {
    Object.assign(Config, { zoomProductionMode })
  })

  afterAll(async done => {
    // restore original config
    Object.assign(Config, { skipEmailVerification, zoomProductionMode })
    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    server.close(err => {
      console.log('verificationAPI: closing server', { err })
      done()
    })
  })

  describe('face verification', () => {
    let token
    let helper
    let zoomServiceMock
    const enrollmentProcessor = createEnrollmentProcessor(storage)
    const { keepEnrollments } = enrollmentProcessor

    // wallet mocks
    const whitelistUserMock = jest.fn()
    const isVerifiedMock = jest.fn()

    const licenseKey = 'fake-license'
    const licenseType = ZoomLicenseType.Browser
    const sessionToken = 'fake-session-id'
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

    const mockSuccessVerification = () => {
      helper.mockEnrollmentNotFound(enrollmentIdentifier)
      helper.mockSuccessEnrollment(enrollmentIdentifier)
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
    const testVerificationSuccessfull = async (alreadyEnrolled = false) =>
      request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          enrollmentResult: {
            alreadyEnrolled,
            isVerified: true,
            message: `The FaceMap was ${alreadyEnrolled ? 'already' : 'successfully'} enrolled.`
          }
        })

    const testDisposalState = async isDisposing => {
      await request(server)
        .get(enrollmentUri)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, isDisposing })
    }

    const testWhitelisted = async () => {
      const { address, profilePublickey } = await getCreds()

      // checking is user was actrally re-whitelisted in the wallet
      expect(whitelistUserMock).toHaveBeenCalledWith(address.toLowerCase(), profilePublickey)
    }

    const testNotVerified = async () => {
      // to check that user hasn't been updated nowhere:
      // in the database
      const { isVerified } = await storage.getUser(userIdentifier)

      expect(isVerified).toBeFalsy()
      // and in the wallet
      expect(whitelistUserMock).not.toHaveBeenCalled()
    }

    beforeAll(async () => {
      AdminWallet.whitelistUser = whitelistUserMock
      AdminWallet.isVerified = isVerifiedMock

      zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
      helper = createMockingHelper(zoomServiceMock)
      token = await getToken(server)
    })

    beforeEach(async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: false })
      await storage.taskModel.deleteMany(forEnrollment(enrollmentIdentifier))

      enrollmentProcessor.keepEnrollments = 24
      isVerifiedMock.mockResolvedValue(false)
      whitelistUserMock.mockImplementation(noopAsync)
    })

    afterEach(() => {
      whitelistUserMock.mockReset()
      zoomServiceMock.reset()
    })

    afterAll(() => {
      const restoreWalletMethods = ['whitelistUser', 'isVerified']

      restoreWalletMethods.forEach(method => (AdminWallet[method] = AdminWallet.constructor.prototype[method]))

      assign(enrollmentProcessor, { keepEnrollments })
      zoomServiceMock.restore()
      zoomServiceMock = null
      helper = null
    })

    test('Face verification endpoints returns 401 without credentials', async () => {
      await request(server)
        .post(licenseUri())
        .send({})
        .expect(401)

      await request(server)
        .post(sessionUri)
        .send({})
        .expect(401)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .expect(401)

      await request(server)
        .get(enrollmentUri)
        .expect(401)

      await request(server)
        .delete(enrollmentUri)
        .expect(401)
    })

    test('POST /verify/face/license/:licenseType returns 200, success: true and license', async () => {
      Config.zoomProductionMode = true
      helper.mockSuccessLicenseKey(licenseType, licenseKey)

      await request(server)
        .post(licenseUri())
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          license: licenseKey
        })
    })

    test('POST /verify/face/license/:licenseType returns 400, success: false if Zoom API fails', async () => {
      const message = 'No license found in the database for this platformID.'

      Config.zoomProductionMode = true
      helper.mockFailedLicenseKey(licenseType, message)

      await request(server)
        .post(licenseUri())
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: message
        })
    })

    test("POST /verify/face/license/:licenseType returns 400, success: false when license type isn't valid", async () => {
      Config.zoomProductionMode = true

      await request(server)
        .post(licenseUri('unknown'))
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'Invalid input'
        })
    })

    test('POST /verify/face/license/:licenseType executes in production mode only', async () => {
      await request(server)
        .post(licenseUri())
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'Cannot obtain production license running non-production mode.'
        })
    })

    test('POST /verify/face/session returns 200, success: true and sessionToken', async () => {
      helper.mockSuccessSessionToken(sessionToken)

      await request(server)
        .post(sessionUri)
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          sessionToken
        })
    })

    test('POST /verify/face/session returns 400, success: false if Zoom API fails', async () => {
      const message = 'FaceTec API response is empty'

      helper.mockFailedSessionToken(message)

      await request(server)
        .post(sessionUri)
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
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

    test("PUT /verify/face/:enrollmentIdentifier returns 200 and success: false when verification wasn't successfull", async () => {
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
            isVerified: false,
            isDuplicate: true,
            success: true,
            error: false
          }
        })

      await testNotVerified()
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

    test('PUT /verify/face/:enrollmentIdentifier passes full verification flow even if user was already verified', async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: true })

      helper.mockEnrollmentFound(enrollmentIdentifier)
      helper.mockSuccessUpdateEnrollment(enrollmentIdentifier)
      helper.mockEmptyResultsFaceSearch(enrollmentIdentifier)

      await testVerificationSuccessfull(true)
      await testWhitelisted()
    })

    test('PUT /verify/face/:enrollmentIdentifier skips verification and re-whitelists user if request comes from E2E test runs', async () => {
      const currentEnv = Config.env

      Config.env = 'development'

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .set(
          'User-Agent',
          'Mozilla/5.0 (X11; Linux x86_64; Cypress) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36'
        )
        .expect(200, { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } })
        .then(testWhitelisted)
        .finally(() => (Config.env = currentEnv))
    })

    test('PUT /verify/face/:enrollmentIdentifier skips verification and re-whitelists user if FV disabled', async () => {
      const currentDisabledState = Config.disableFaceVerification

      Config.disableFaceVerification = true

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } })
        .then(testWhitelisted)
        .finally(() => (Config.disableFaceVerification = currentDisabledState))
    })

    test('PUT /verify/face/:enrollmentIdentifier skips verification and re-whitelists user if the dups are allowed', async () => {
      const currentDupsState = Config.allowDuplicatedFaceRecords

      Config.allowDuplicatedFaceRecords = true

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } })
        .then(testWhitelisted)
        .finally(() => (Config.allowDuplicatedFaceRecords = currentDupsState))
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 200, success = true and enqueues disposal task if signature is valid', async () => {
      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true })

      const filters = forEnrollment(enrollmentIdentifier, DisposeAt.AccountRemoved)

      await expect(storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, filters)).resolves.toBe(true)
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 400 and success = false if signature is invalid', async () => {
      await request(server)
        .delete(enrollmentUri)
        .query({ signature: 'invalid signature' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'SigUtil unable to recover the message signer'
        })
    })

    test("GET /verify/face/:enrollmentIdentifier returns isDisposing = false if face snapshot hasn't been enqueued yet for the disposal", async () => {
      await testDisposalState(false)
    })

    test('GET /verify/face/:enrollmentIdentifier returns isDisposing = true if face snapshot has been enqueued for the disposal', async () => {
      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)

      await testDisposalState(true)
    })
  })

  test('/verify/sendotp without creds -> 401', async () => {
    await request(server)
      .post('/verify/sendotp')
      .expect(401)
  })

  test('/verify/sendotp saves mobile', async () => {
    const token = await getToken(server)
    await storage.updateUser({
      identifier: userIdentifier,
      smsValidated: false,
      fullName: 'test_user_sendemail'
    })

    await request(server)
      .post('/verify/sendotp')
      .send({ user: { mobile: '+972507311111' } })
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, alreadyVerified: false })

    expect(await storage.getByIdentifier(userIdentifier)).toMatchObject({ otp: { mobile: '+972507311111' } })
  })

  test('/verify/sendotp should fail with 429 status - too many requests (rate limiter)', async () => {
    let isFailsWithRateLimit = false

    while (!isFailsWithRateLimit) {
      const res = await request(server).post('/verify/sendotp')

      if (res.status === 429) {
        isFailsWithRateLimit = true
      }
    }

    expect(isFailsWithRateLimit).toBeTruthy()
  })

  test('/verify/sendemail with creds', async () => {
    // eslint-disable-next-line import/namespace
    awsSes.sendTemplateEmail = jest.fn().mockReturnValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    const token = await getToken(server)

    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    const user = await storage.updateUser({
      identifier: userIdentifier,
      fullName: 'test_user_sendemail'
    })

    expect(user).toBeTruthy()

    await request(server)
      .post('/verify/sendemail')
      .send({
        user: {
          fullName: 'h r',
          email: 'johndoe@gooddollar.org'
        }
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, alreadyVerified: false })

    await delay(500)

    const dbUser = await storage.getUser(userIdentifier)

    expect(dbUser.emailVerificationCode).toBeTruthy()
    awsSes.sendTemplateEmail.mockRestore()
  })

  test('/verify/sendemail should fail with 429 status - too many requests (rate limiter)', async () => {
    // eslint-disable-next-line import/namespace
    awsSes.sendTemplateEmail = jest.fn().mockReturnValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    const user = await storage.updateUser({
      identifier: userIdentifier,
      fullName: 'test_user_sendemail'
    })

    expect(user).toBeTruthy()
    let isFailsWithRateLimit = false

    while (!isFailsWithRateLimit) {
      const res = await request(server)
        .post('/verify/sendemail')
        .send({
          user: {
            fullName: 'h r',
            email: 'johndoe@gooddollar.org'
          }
        })

      if (res.status === 429) {
        isFailsWithRateLimit = true
      }
    }

    expect(isFailsWithRateLimit).toBeTruthy()
    awsSes.sendTemplateEmail.mockRestore()
  })

  test('/verify/phase', async () => {
    const { phase } = Config

    await request(server)
      .get('/verify/phase')
      .expect(200, { success: true, phase })
  })
})

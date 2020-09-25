import request from 'supertest'
import MockAdapter from 'axios-mock-adapter'

import { assign, omit, invokeMap } from 'lodash'

import Config from '../../server.config'

import storage from '../../db/mongo/user-privat-provider'
import AdminWallet from '../../blockchain/AdminWallet'
import { GunDBPublic } from '../../gun/gun-middleware'

import makeServer from '../../server-test'
import { delay } from '../../utils/timeout'

import createEnrollmentProcessor, { DISPOSE_ENROLLMENTS_TASK } from '../processor/EnrollmentProcessor'
import { getToken, getCreds } from '../../__util__/'
import createMockingHelper from '../api/__tests__/__util__'

describe('verificationAPI', () => {
  let server
  const { skipEmailVerification, claimQueueAllowed } = Config
  const userIdentifier = '0x7ac080f6607405705aed79675789701a48c76f55'

  beforeAll(async done => {
    // remove claim queue, enable E-Mail verification
    assign(Config, {
      claimQueueAllowed: 0,
      skipEmailVerification: false
    })

    jest.setTimeout(50000)
    server = await makeServer(done)

    console.log('the server is ..')
    console.log({ server })
  })

  afterAll(async done => {
    console.log('afterAll')

    // restore original config
    Object.assign(Config, { skipEmailVerification, claimQueueAllowed })
    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    server.close(done)
  })

  describe('face verification', () => {
    let token
    let helper
    let zoomServiceMock
    const enrollmentProcessor = createEnrollmentProcessor(storage)
    const { keepEnrollments } = enrollmentProcessor

    const updateSessionMock = jest.fn()
    const getSessionRefMock = jest.fn()
    const getSessionRefImplementation = GunDBPublic.session

    // wallet mocks
    const whitelistUserMock = jest.fn()
    const isVerifiedMock = jest.fn()

    const sessionToken = 'fake-session-id'
    const enrollmentIdentifier = 'f0D7A688489Ab3079491d407A03BF16e5B027b2c'
    const signature =
      '0xff612279b69900493cec3e5f8707413ad4734aa1748483b61c856d3093bf0c88458e82722365f35dfedf88438ba1419774bbb67527057d9066eba9a548d4fc751b'

    const baseUri = '/verify/face'
    const sessionUri = baseUri + '/session'
    const enrollmentUri = baseUri + '/' + encodeURIComponent(enrollmentIdentifier)

    const payload = {
      sessionId: sessionToken,
      faceMap: Buffer.alloc(32),
      auditTrailImage: 'data:image/png:FaKEimagE==',
      lowQualityAuditTrailImage: 'data:image/png:FaKEimagE=='
    }

    const testInvalidInput = async withoutField =>
      request(server)
        .put(enrollmentUri)
        .send(omit(payload, withoutField))
        .set('Authorization', `Bearer ${token}`)
        .expect(400, { success: false, error: 'Invalid input' })

    const testVerificationSuccessfull = async () =>
      request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, {
          success: true,
          enrollmentResult: {
            isVerified: true,
            alreadyEnrolled: false,
            message: 'The FaceMap was successfully enrolled.'
          }
        })

    const testUserNotApprovedToClaim = async () =>
      request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'User not approved to claim, not in queue or still pending'
        })

    const testVerificationSkipped = async () => {
      const { address, profilePublickey } = await getCreds()

      // checking that there was access to the user's session
      expect(getSessionRefMock).toHaveBeenCalledWith(payload.sessionId)

      // verification & whitelisting state were updated
      expect(updateSessionMock).toHaveBeenCalledWith({ isDuplicate: false, isLive: true, isEnrolled: true })
      expect(updateSessionMock).toHaveBeenCalledWith({ isWhitelisted: true })

      // but enrollment process wasn't started
      expect(updateSessionMock).not.toHaveBeenCalledWith({ isStarted: true })

      // and user was actrally re-whitelisted in the wallet
      expect(whitelistUserMock).toHaveBeenCalledWith(address.toLowerCase(), profilePublickey)
    }

    const testDisposalState = async isDisposing => {
      await request(server)
        .get(enrollmentUri)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, isDisposing })
    }

    beforeAll(async () => {
      GunDBPublic.session = getSessionRefMock
      AdminWallet.whitelistUser = whitelistUserMock
      AdminWallet.isVerified = isVerifiedMock

      zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
      helper = createMockingHelper(zoomServiceMock)
      token = await getToken(server)
    })

    beforeEach(async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: false, claimQueue: null })
      await storage.taskModel.deleteMany({ subject: enrollmentIdentifier })

      enrollmentProcessor.keepEnrollments = 24
      isVerifiedMock.mockResolvedValue(false)
      getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))
    })

    afterEach(() => {
      invokeMap([updateSessionMock, getSessionRefMock, whitelistUserMock], 'mockReset')

      zoomServiceMock.reset()
    })

    afterAll(() => {
      const restoreWalletMethods = ['whitelistUser', 'isVerified']

      GunDBPublic.session = getSessionRefImplementation
      restoreWalletMethods.forEach(method => (AdminWallet[method] = AdminWallet.constructor.prototype[method]))

      assign(enrollmentProcessor, { keepEnrollments })
      zoomServiceMock.restore()
      zoomServiceMock = null
      helper = null
    })

    test('Face verification endpoints returns 401 without credentials', async () => {
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
      helper.mockFailedSessionToken()

      await request(server)
        .post(sessionUri)
        .send({})
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'FaceTec API response is empty'
        })
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 when payload is invalid', async () => {
      await testInvalidInput('sessionId') // no sessionId
      await testInvalidInput('faceMap') // no face map
      await testInvalidInput('auditTrailImage') // no face photoshoots
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 if user is being deleted', async () => {
      await storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, enrollmentIdentifier)

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(400, { success: false, error: 'Facemap record with same identifier is being deleted.' })
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 200 and success: true when verification was successfull', async () => {
      helper.mockEmptyResultsFaceSearch()
      helper.mockSuccessEnrollment(enrollmentIdentifier)

      await testVerificationSuccessfull()

      const { address, profilePublickey } = await getCreds()
      const { isVerified } = await storage.getUser(userIdentifier)

      // to check has user been updated in the database
      expect(isVerified).toBeTruthy()
      // in the GUN session
      expect(updateSessionMock).toHaveBeenCalledWith({ isLive: true, isEnrolled: true })
      expect(updateSessionMock).toHaveBeenCalledWith({ isWhitelisted: true })
      // and in the waller
      expect(whitelistUserMock).toHaveBeenCalledWith(address.toLowerCase(), profilePublickey)
    })

    test("PUT /verify/face/:enrollmentIdentifier returns 200 and success: false when verification wasn't successfull", async () => {
      helper.mockDuplicateFound()

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
            code: 200,
            message: 'The search request was processed successfully.'
          }
        })

      // checking that duplicate flag was set in the session
      expect(updateSessionMock).toHaveBeenCalledWith({ isDuplicate: true })

      // to check that user hasn't beed updated nowhere

      // in the database
      const { isVerified } = await storage.getUser(userIdentifier)

      expect(isVerified).toBeFalsy()

      // in the session
      expect(updateSessionMock).not.toHaveBeenCalledWith({ isLive: true, isEnrolled: true })
      expect(updateSessionMock).not.toHaveBeenCalledWith({ isWhitelisted: true })

      // and in the wallet
      expect(whitelistUserMock).not.toHaveBeenCalled()
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 and success = false when user not approved in the claim queue', async () => {
      // enabling claim queue.
      Config.claimQueueAllowed = 1
      helper.mockEmptyResultsFaceSearch()
      helper.mockSuccessEnrollment(enrollmentIdentifier)

      // user with empty status
      await testUserNotApprovedToClaim()

      // user with pending status
      await storage.updateUser({ identifier: userIdentifier, claimQueue: { status: 'pending' } })
      await testUserNotApprovedToClaim()
    })

    test('PUT /verify/face/:enrollmentIdentifier users approved in the claim queue will be verified as usual', async () => {
      // enabling claim queue.
      Config.claimQueueAllowed = 1
      helper.mockEmptyResultsFaceSearch()
      helper.mockSuccessEnrollment(enrollmentIdentifier)

      // user with approved status
      await storage.updateUser({ identifier: userIdentifier, claimQueue: { status: 'approved' }, isVerified: false })
      await testVerificationSuccessfull()

      // user with whitelisted status
      await storage.updateUser({ identifier: userIdentifier, claimQueue: { status: 'whitelisted' }, isVerified: false })
      await testVerificationSuccessfull()
    })

    test('PUT /verify/face/:enrollmentIdentifier whitelists user in the claim queue', async () => {
      // enabling claim queue.
      Config.claimQueueAllowed = 1
      helper.mockEmptyResultsFaceSearch()
      helper.mockSuccessEnrollment(enrollmentIdentifier)

      // set approved status
      await storage.updateUser({ identifier: userIdentifier, claimQueue: { status: 'approved' }, isVerified: false })
      await testVerificationSuccessfull()

      const { claimQueue } = await storage.getUser(userIdentifier)

      // to check has user been updated in the database
      expect(claimQueue).toHaveProperty('status', 'whitelisted')
    })

    test('PUT /verify/face/:enrollmentIdentifier skips verification and re-whitelists user was already verified', async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: true })

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } })

      await testVerificationSkipped()
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
        .then(testVerificationSkipped)
        .finally(() => (Config.env = currentEnv))
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 200, success = true and enqueues disposal task if enrollment exists, signature is valid and KEEP_FACE_VERIFICATION_RECORDS is set', async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)

      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true })

      await expect(storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, { subject: enrollmentIdentifier })).resolves.toBe(
        true
      )
    })

    test("DELETE /verify/face/:enrollmentIdentifier returns 200 and success = true but disposes enrollment immediately if KEEP_FACE_VERIFICATION_RECORDS isn't set", async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)
      enrollmentProcessor.keepEnrollments = 0

      await request(server)
        .delete(enrollmentUri)
        .query({ signature })
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true })

      await expect(storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, { subject: enrollmentIdentifier })).resolves.toBe(
        false
      )
    })

    test('DELETE /verify/face/:enrollmentIdentifier returns 400 and success = false if signature is invalid', async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)

      await request(server)
        .delete(enrollmentUri)
        .query({ signature: 'invalid signature' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400, {
          success: false,
          error: 'Unable to enqueue enrollment disposal: SigUtil unable to recover the message signer'
        })
    })

    test("GET /verify/face/:enrollmentIdentifier returns isDisposing = false if face snapshot hasn't been enqueued yet for the disposal", async () => {
      await testDisposalState(false)
    })

    test('GET /verify/face/:enrollmentIdentifier returns isDisposing = true if face snapshot has been enqueued for the disposal', async () => {
      helper.mockEnrollmentFound(enrollmentIdentifier)

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
      .expect(200, { ok: 1 })
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
      .expect(200, { ok: 1 })

    await delay(500)

    const dbUser = await storage.getUser(userIdentifier)

    expect(dbUser.emailVerificationCode).toBeTruthy()
  })

  test('/verify/sendemail should fail with 429 status - too many requests (rate limiter)', async () => {
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
  })

  test('/verify/w3/email without auth creds -> 401', () => {
    return request(server)
      .post('/verify/w3/email')
      .then(res => {
        expect(res.statusCode).toBe(401)
      })
  })

  test('/verify/w3/email without w3 token', async () => {
    const token = await getToken(server)
    const res = await request(server)
      .post('/verify/w3/email')
      .send({
        email: 'johndoe@gooddollar.org'
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ ok: -1, message: 'email and w3Token is required' })
  })

  test('/verify/w3/email with wrong w3 token', async () => {
    const token = await getToken(server)
    const res = await request(server)
      .post('/verify/w3/email')
      .send({
        token: 'wrong_token',
        email: 'johndoe@gooddollar.org'
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ ok: -1, message: 'Wrong web3 token or email' })
  })

  test('/verify/w3/logintoken should generate token if email is given', async () => {
    await storage.updateUser({
      identifier: userIdentifier,
      fullName: 'test_user_sendemail',
      email: 'testlogintoken@gooddollarx.org'
    })
    const token = await getToken(server)

    let res = await request(server)
      .get('/verify/w3/logintoken')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('/verify/w3/bonuses without auth creds -> 401', () => {
    return request(server)
      .get('/verify/w3/bonuses')
      .then(res => {
        expect(res.statusCode).toBe(401)
      })
  })

  test('/verify/w3/bonuses should not fail for non whitelisted ', async () => {
    const creds = await getCreds(true)
    const token = await getToken(server, creds)
    console.log({ creds, token })

    const res = await request(server)
      .get('/verify/w3/bonuses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: 0,
      message: 'User should be verified to get bonuses'
    })
  })

  test('/verify/w3/bonuses should fail with missing token for whitelisted', async () => {
    const creds = await getCreds(true)
    const token = await getToken(server, creds)
    await AdminWallet.ready
    await AdminWallet.whitelistUser(creds.address, 'x' + Math.random())
    const res = await request(server)
      .get('/verify/w3/bonuses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      ok: -1,
      message: 'Missed W3 token'
    })
  })

  test('/verify/phase', async () => {
    const { phase } = Config

    await request(server)
      .get('/verify/phase')
      .expect(200, { success: true, phase })
  })
})

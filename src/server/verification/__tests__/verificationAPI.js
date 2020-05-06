import request from 'supertest'
import moment from 'moment'
import delay from 'delay'
import MockAdapter from 'axios-mock-adapter'
import { omit, invokeMap } from 'lodash'

import Config from '../../server.config'

import storage from '../../db/mongo/user-privat-provider'
import AdminWallet from '../../blockchain/AdminWallet'
import { GunDBPublic } from '../../gun/gun-middleware'

import makeServer from '../../server-test'
import createEnrollmentProcessor from '../processor/EnrollmentProcessor'
import { getToken, getCreds } from '../../__util__/'
import createMockingHelper from '../api/__tests__/__util__'

describe('verificationAPI', () => {
  let server
  let { skipEmailVerification } = Config
  const userIdentifier = '0x7ac080f6607405705aed79675789701a48c76f55'

  beforeAll(done => {
    Config.skipEmailVerification = false
    jest.setTimeout(50000)
    server = makeServer(done)

    console.log('the server is ..')
    console.log({ server })
  })

  afterAll(async done => {
    console.log('afterAll')

    Object.assign(Config, { skipEmailVerification })
    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    server.close(err => {
      done()
    })
  })

  describe('face verification', () => {
    let token
    let helper
    let zoomServiceMock

    const updateSessionMock = jest.fn()
    const whitelistUserMock = jest.fn()
    const getSessionRefMock = jest.fn()
    const getSessionRefImplementation = GunDBPublic.session

    const enrollmentIdentifier = 'fake-enrollment-identifier'

    const enrollmentUri = '/verify/face/' + encodeURIComponent(enrollmentIdentifier)

    const payload = {
      sessionId: 'fake-session-id',
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

    beforeAll(async () => {
      const enrollmentProcessor = createEnrollmentProcessor(storage)

      GunDBPublic.session = getSessionRefMock
      AdminWallet.whitelistUser = whitelistUserMock

      zoomServiceMock = new MockAdapter(enrollmentProcessor.provider.api.http)
      helper = createMockingHelper(zoomServiceMock)
      token = await getToken(server)
    })

    beforeEach(async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: false })

      getSessionRefMock.mockImplementation(() => ({ put: updateSessionMock }))
    })

    afterEach(() => {
      invokeMap([updateSessionMock, getSessionRefMock, whitelistUserMock], 'mockReset')

      zoomServiceMock.reset()
    })

    afterAll(() => {
      GunDBPublic.session = getSessionRefImplementation
      AdminWallet.whitelistUser = AdminWallet.constructor.prototype.whitelistUser

      zoomServiceMock.restore()
      zoomServiceMock = null
      helper = null
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 401 without credentials', async () => {
      await request(server)
        .put(enrollmentUri)
        .expect(401)
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 400 when payload is invalid', async () => {
      await testInvalidInput('sessionId') // no sessionId
      await testInvalidInput('faceMap') // no face map
      await testInvalidInput('auditTrailImage') // no face photoshoots
    })

    test('PUT /verify/face/:enrollmentIdentifier returns 200 and success: true when verification was successfull', async () => {
      helper.mockEmptyResultsFaceSearch()
      helper.mockSuccessEnrollment(enrollmentIdentifier)

      await request(server)
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
            isDuplicate: true
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

    test('PUT /verify/face/:enrollmentIdentifier skips verification and re-whitelists user was already verified', async () => {
      await storage.updateUser({ identifier: userIdentifier, isVerified: true })

      await request(server)
        .put(enrollmentUri)
        .send(payload)
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { success: true, enrollmentResult: { isVerified: true, alreadyEnrolled: true } })

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
    })
  })

  test('/verify/sendotp without creds -> 401', async () => {
    await request(server)
      .post('/verify/sendotp')
      .expect(401)
  })

  test('/verify/sendotp without sms validation', async () => {
    const token = await getToken(server)
    await storage.updateUser({
      identifier: userIdentifier,
      smsValidated: false,
      fullName: 'test_user_sendemail'
    })

    await request(server)
      .post('/verify/sendotp')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
  })

  test('/verify/sendotp with creds', async () => {
    const token = await getToken(server)
    await request(server)
      .post('/verify/sendotp')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
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
        console.log('res test', res.statusCode)
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

  test('/verify/w3/logintoken', async () => {
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

  test('/verify/hanuka-bonus witout auth creds', async () => {
    let res = await request(server).get('/verify/hanuka-bonus')

    expect(res.status).toBe(401)
  })

  test('/verify/hanuka-bonus with wrong dates', async () => {
    Config.hanukaStartDate = moment('01/01/2018').format('DD/MM/YYYY')
    Config.hanukaEndDate = moment('01/02/2018').format('DD/MM/YYYY')

    const creds = await getCreds(true)
    const token = await getToken(server, creds)

    let res = await request(server)
      .get('/verify/hanuka-bonus')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: 0,
      message: 'That is no the period of Hanuka bonus'
    })
  })

  test('/verify/hanuka-bonus errored with trying to get bonus 2 times per day', async () => {
    Config.hanukaStartDate = moment()
      .subtract(1, 'day')
      .format('DD/MM/YYYY')
    Config.hanukaEndDate = moment()
      .add(1, 'day')
      .format('DD/MM/YYYY')

    const creds = await getCreds(true)
    const token = await getToken(server, creds)

    let res = await request(server)
      .get('/verify/hanuka-bonus')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: 1
    })

    await delay(7000)

    let res2 = await request(server)
      .get('/verify/hanuka-bonus')
      .set('Authorization', `Bearer ${token}`)

    expect(res2.status).toBe(200)
    console.log('qqq', res2.body)
    expect(res2.body).toMatchObject({
      message: 'The user already get Hanuka bonus today'
    })
  })

  test('/verify/hanuka-bonus with correct dates', async () => {
    Config.hanukaStartDate = moment()
      .subtract(1, 'day')
      .format('DD/MM/YYYY')
    Config.hanukaEndDate = moment()
      .add(1, 'day')
      .format('DD/MM/YYYY')

    const creds = await getCreds(true)
    const token = await getToken(server, creds)

    let res = await request(server)
      .get('/verify/hanuka-bonus')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: 1
    })
  })
})

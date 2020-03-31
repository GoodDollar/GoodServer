// import fs from 'fs'
import request from 'supertest'
// import FormData from 'form-data'
import moment from 'moment'
import delay from 'delay'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__/'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import Config from '../../server.config'
import AdminWallet from '../../blockchain/AdminWallet'

const storage = UserDBPrivate

Config.skipEmailVerification = false
describe('verificationAPI', () => {
  let server
  beforeAll(done => {
    jest.setTimeout(50000)
    server = makeServer(done)
    console.log('the server is ..')
    console.log({ server })
  })

  afterAll(async done => {
    console.log('afterAll')

    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    server.close(err => {
      done()
    })
  })

  test('/verify/sendotp without creds -> 401', async () => {
    await request(server)
      .post('/verify/sendotp')
      .expect(401)
  })

  test('/verify/sendotp without sms validation', async () => {
    const userCredentials = {
      signature:
        '0x7acee1dc0d8a07d3e4f2cd1cbbebed9098afea5600bbb1f8a99bd7154e2de4a35e42b868dd373a831e78f0bbf2a8d0340cc63fa8345e433fd3fe64b01bcae0781c',
      gdSignature:
        '0xd2e95cd11e2b3148674f2207d4f054dbf25e4d2a6e763418ba9bd62c5a99be621f738a0419c4754cc95395c93ac76688f781d7cb00dda0b79693c05de0bee4971b',
      nonce: 'a29344af372abf77dd68',
      profileSignature:
        'SEA{"m":"Login to GoodDAPPa29344af372abf77dd68","s":"nxiNDIdE714q1qTHGzXDy/uJqnXD4uE/QBQDym2ZTTN8cxQyBlODP7x/7+LQggC0K4uO6Y+tTddGLHdSyJGblQ=="}',
      profilePublickey: 'kxudRZes6qS44fus50kd0knUVftOeyDTQnmsnMmiaWA.uzJ1fJM0evhtave7yZ5OWBa2O91MBU7DNAHau8xUXYw',
      networkId: 4447
    }
    const creds = await getCreds(true)
    const token = await getToken(server, creds)
    await UserDBPrivate.updateUser({ identifier: token, smsValidated: false, fullName: 'test_user_sendemail' })

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

    const user = await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
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

    const dbUser = await UserDBPrivate.getUser('0x7ac080f6607405705aed79675789701a48c76f55')

    expect(dbUser.emailVerificationCode).toBeTruthy()
  })

  test('/verify/sendemail should fail with 429 status - too many requests (rate limiter)', async () => {
    const token = await getToken(server)

    await storage.model.deleteMany({ fullName: new RegExp('test_user_sendemail', 'i') })

    const user = await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
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

  /*test('/verify/facerecognition creates proper verification data from a valid request', async () => {
    const token = await getToken(server)
    let req = new FormData()

    req.append('sessionId', 'fake-session-id')
    const facemap = fs.createReadStream('./facemap.zip')
    const auditTrailImage = fs.createReadStream('./auditTrailImage.jpg')
    req.append('facemap', facemap, { contentType: 'application/zip' })
    req.append('auditTrailImage', auditTrailImage, { contentType: 'image/jpeg' })
    req.append('enrollmentIdentifier', '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5')
    const res = await request(server)
      .post('/verify/facerecognition')
      .send(req)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', `multipart/form-data;`)
    console.log({ res })
  })*/

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

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
    await AdminWallet.whitelistUser(creds.address, 'x')
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

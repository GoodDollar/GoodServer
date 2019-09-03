import fs from 'fs'
import request from 'supertest'
import FormData from 'form-data'
import delay from 'delay'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import { GunDBPrivate } from '../../gun/gun-middleware'
import Config from '../../server.config'

Config.skipEmailVerification = false
describe('verificationAPI', () => {
  let server
  beforeAll(done => {
    jest.setTimeout(10000)
    server = makeServer(done)
    console.log('the server is ..')
    console.log({ server })
  })

  afterAll(done => {
    console.log('afterAll')
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
      profilePublickey: 'kxudRZes6qS44fus50kd0knUVftOeyDTQnmsnMmiaWA.uzJ1fJM0evhtave7yZ5OWBa2O91MBU7DNAHau8xUXYw'
    }
    const token = await getToken(server, userCredentials)
    await GunDBPrivate.updateUser({ identifier: token, smsValidated: false })

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

  test('/verify/sendemail with creds', async () => {
    const token = await getToken(server)
    const res = await request(server)
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
    const dbUser = await GunDBPrivate.getUser('0x7ac080f6607405705aed79675789701a48c76f55')
    expect(dbUser).toMatchObject({ mauticId: expect.any(Number), emailVerificationCode: expect.any(Number) })
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

  test('/verify/w3/email with valid creds', async () => {
    const token = await getToken(server)
    const res = await request(server)
      .post('/verify/w3/email')
      .send({
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjp7ImlkIjo1OH0sImlhdCI6MTU2NzUyMTk4N30.ELhx-PQs0ypGAIYZ_Y2JD46x7uLX6stxR0a2JqK5gF4',
        email: 'fedyshyn.y@gmail.com'
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: 1 })
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
})

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import { GunDBPrivate } from '../../gun/gun-middleware'

describe('verificationAPI', () => {
  let server
  beforeAll(done => {
    server = makeServer(done)
  })

  afterAll(done => {
    console.log('afterAll')
    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/verify/sendotp without creds -> 401', done => {
    request(server)
      .post('/verify/sendotp')
      .expect(401, done)
  })

  test('/verify/sendotp with creds', async done => {
    const token = await getToken(server)
    request(server)
      .post('/verify/sendotp')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } }, done)
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
    const dbUser = await GunDBPrivate.getUser('0x7ac080f6607405705aed79675789701a48c76f55')
    expect(dbUser).toMatchObject({ mauticId: expect.any(Number), emailVerificationCode: expect.any(Number) })
  })
})

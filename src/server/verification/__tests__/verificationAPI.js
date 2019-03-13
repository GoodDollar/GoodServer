import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'

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
      .expect(200, { ok: 1 }, done)
  })
})

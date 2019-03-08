import request from 'supertest'
import makeServer from '../../server-test'

describe('verificationAPI', () => {
  let server
  beforeAll(async done => {
    server = makeServer(done)
  })

  afterAll(done => {
    console.log('afterAll')
    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/verify/sendotp', done => {
    request(server)
      .post('/verify/sendotp')
      .expect(401, done)
  })
})

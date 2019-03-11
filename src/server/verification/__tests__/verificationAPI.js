import request from 'supertest'
import makeServer from '../../server-test'

const getToken = server => {
  const creds = {
    jwt: '',
    pubkey: '0x7ac080F6607405705AED79675789701a48C76f55',
    signature:
      '0xaa4eb02d727ab09e6621060f26cff3ceecb3a0901b4f7de564490646482ced3c1c18bf310509a0d3ef7b622c458083a2dce27b3763714bb10d82f53bdb6559a21c'
  }
  return request(server)
    .post('/auth/eth')
    .send(creds)
    .expect(200)
    .then(response => response.body.token)
}

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
  }, 10000)
})

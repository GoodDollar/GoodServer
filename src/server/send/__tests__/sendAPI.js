import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'

describe('sendAPÏ', () => {
  let server
  beforeAll(done => {
    server = makeServer(done)
  })

  afterAll(done => {
    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/send/linkemail without creds -> 401', done => {
    request(server)
      .post('/send/linkemail')
      .expect(401, done)
  })

  test('/send/linkemailwith creds', async done => {
    const token = await getToken(server)
    request(server)
      .post('/send/linkemail')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } }, done)
  })
})

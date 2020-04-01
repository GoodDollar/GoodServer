import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'

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

describe.skip('loadtest-middleware', () => {
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

  test('/test/add/whitelistUser', async () => {
    const token = await getToken(server)

    let res = await request(server)
      .post('/test/add/whitelistUser')
      .send(userCredentials)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('/storage/login/token witout auth creds', async () => {
    let res = await request(server).post('/test/add/whitelistUser')

    expect(res.status).toBe(401)
  })
})

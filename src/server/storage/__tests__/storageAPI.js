// @flow
import request from 'supertest'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__/'
import type { UserRecord } from '../../../imports/types'

describe('storageAPI', () => {
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

  test('/user/add creds', async done => {
    const token = await getToken(server)
    console.log(token)
    const user: UserRecord = { identifier: '0x7ac080f6607405705aed79675789701a48c76f55' }
    request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
      .expect(200, { ok: 1 }, done)
  })

  test('/user/add false creds', async done => {
    const token = await getToken(server)
    const user: UserRecord = { identifier: '0x7ac080f6607405705aed79675789701a48c76f56' }
    request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
      .expect(400, done)
  })
})

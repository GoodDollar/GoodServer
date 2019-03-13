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
    const { pubkey } = getCreds()
    const user: UserRecord = { pubkey }
    request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
      .expect(200, { ok: 1 }, done)
  })
})

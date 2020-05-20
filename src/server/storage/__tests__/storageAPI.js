/**
 * @jest-environment node
 */

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__/'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
describe('storageAPI', () => {
  let server, creds, token
  beforeAll(async done => {
    await UserDBPrivate.model.deleteMany({ claimQueue: { $exists: true } })

    jest.setTimeout(30000)
    server = makeServer(done)
  })

  afterAll(done => {
    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/user/enqueue let user in when available places', async () => {
    //1 person is allowed in CLAIM_QUEUE_ALLOWED
    const approvedCreds = await getCreds(true)
    const approvedToken = await getToken(server, approvedCreds)

    await UserDBPrivate.updateUser({ identifier: token, smsValidated: false, fullName: 'test_user_sendemail' })

    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${approvedToken}`)
      .send()
    expect(res.body).toEqual({ ok: 1, queue: { status: 'approved' } })
  })

  test('/user/enqueue adds non existing user to queue', async () => {
    creds = await getCreds(true)
    token = await getToken(server, creds)

    await UserDBPrivate.updateUser({ identifier: token, smsValidated: false, fullName: 'test_user_sendemail' })

    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()
    expect(res.body).toEqual({ ok: 1, queue: { status: 'pending' } })
  })

  test('/user/enqueue returns existing queue status', async () => {
    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()
    expect(res.body).toEqual({ ok: 0, queue: { status: 'pending', date: expect.any(String) } })
  })
})

/**
 * @jest-environment node
 */

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import PropsModel from '../../db/mongo/models/props'

describe('claimQueueAPI', () => {
  let server, creds, token
  beforeAll(async done => {
    await UserDBPrivate.model.deleteMany({ claimQueue: { $exists: true } })
    await PropsModel.deleteMany({})
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

    await UserDBPrivate.addUser({
      identifier: approvedCreds.address,
      smsValidated: false,
      fullName: 'test_user_queue_approved'
    })

    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${approvedToken}`)
      .send()
    expect(res.body).toEqual({ ok: 1, queue: { status: 'approved', date: expect.anything() } })
  })

  test('/user/enqueue adds non existing user to queue', async () => {
    creds = await getCreds(true)
    token = await getToken(server, creds)

    await UserDBPrivate.addUser({
      identifier: creds.address,
      mauticId: 1,
      smsValidated: false,
      fullName: 'test_user_queue1'
    })

    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()
    expect(res.body).toEqual({ ok: 1, queue: { status: 'pending', date: expect.anything() } })
  })

  test('/user/enqueue returns existing queue status', async () => {
    const res = await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()
    expect(res.body).toEqual({ ok: 0, queue: { status: 'pending', date: expect.any(String) } })
  })

  test('/admin/queue approve users and raise openspaces', async () => {
    creds = await getCreds(true)
    token = await getToken(server, creds)

    await UserDBPrivate.addUser({
      identifier: creds.address,
      mauticId: 2,
      smsValidated: false,
      fullName: 'test_user_queue2'
    })

    await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()

    creds = await getCreds(true)
    token = await getToken(server, creds)

    await UserDBPrivate.addUser({
      identifier: creds.address,
      mauticId: 3,
      smsValidated: false,
      fullName: 'test_user_queue3'
    })

    await request(server)
      .post('/user/enqueue')
      .set('Authorization', `Bearer ${token}`)
      .send()

    const res = await request(server)
      .post('/admin/queue')
      .send({ allow: 2, password: process.env.GUNDB_PASS })
    expect(res.body).toMatchObject({
      ok: 1,
      newAllowed: 3,
      //user should be approved in order
      pendingUsers: expect.arrayContaining([
        expect.objectContaining({ mauticId: '1' }),
        expect.objectContaining({ mauticId: '2' })
      ]),
      stillPending: 1
    })
    expect(res.body.pendingUsers).not.toEqual(expect.arrayContaining([{ mauticId: '3' }]))

    const updated = await PropsModel.findOne({ name: 'claimQueueAllowed' })
    expect(updated.value).toEqual(3)

    const stillPending = await UserDBPrivate.model.count({ 'claimQueue.status': 'pending' })
    expect(stillPending).toEqual(1)
  })
})

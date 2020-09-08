/**
 * @jest-environment node
 */

import request from 'supertest'
import { sha3 } from 'web3-utils'
import conf from '../../server.config'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { ClaimQueueProps } from '../../db/mongo/models/props'

jest.setTimeout(10000)
describe('claimQueueAPI', () => {
  let server, creds, token
  const { claimQueueAllowed } = conf

  beforeAll(async done => {
    conf.claimQueueAllowed = 1

    await UserDBPrivate.model.deleteMany({ claimQueue: { $exists: true } })
    await ClaimQueueProps.deleteMany({})

    jest.setTimeout(30000)
    server = makeServer(done)
  })

  afterAll(done => {
    Object.assign(conf, { claimQueueAllowed })

    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/user/enqueue let user in when available places', async () => {
    // 1 person is allowed in CLAIM_QUEUE_ALLOWED
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
      // user should be approved in order
      approvedUsers: expect.arrayContaining([
        expect.objectContaining({ mauticId: '1' }),
        expect.objectContaining({ mauticId: '2' })
      ]),
      stillPending: 1
    })

    expect(res.body.pendingUsers).not.toEqual(expect.arrayContaining([{ mauticId: '3' }]))

    const updated = await ClaimQueueProps.findOne({})
    expect(updated.value).toEqual(3)

    const stillPending = await UserDBPrivate.model.count({ 'claimQueue.status': 'pending' })
    expect(stillPending).toEqual(1)
  })

  describe('/admin/queue approve users by email', () => {
    let token, creds
    beforeAll(async () => {
      await UserDBPrivate.model.deleteMany({})
      let queueProps = await ClaimQueueProps.findOne({})
      queueProps.value = 0
      queueProps.save() //make sure no user is preapproved
      creds = await getCreds(true)
      token = await getToken(server, creds)

      await UserDBPrivate.addUser({
        identifier: creds.address,
        mauticId: 10,
        smsValidated: false,
        fullName: 'test_user_queue10',
        email: sha3('test1@gmail.com')
      })

      await request(server)
        .post('/user/enqueue')
        .set('Authorization', `Bearer ${token}`)
        .send()

      creds = await getCreds(true)
      token = await getToken(server, creds)

      await UserDBPrivate.addUser({
        identifier: creds.address,
        mauticId: 11,
        smsValidated: false,
        fullName: 'test_user_queue11',
        email: sha3('test2@gmail.com')
      })
    })

    test('users are approved by email', async () => {
      const res = await request(server)
        .post('/admin/queue')
        .send({ emails: ['test1@gmail.com', 'test2@gmail.com'], password: process.env.GUNDB_PASS })

      expect(res.body).toMatchObject({
        ok: 1,
        // user should be approved in order
        approvedUsers: expect.arrayContaining([
          expect.objectContaining({ mauticId: '10' }),
          expect.objectContaining({ mauticId: '11' })
        ])
      })

      expect(res.body.approvedUsers.length).toEqual(2)

      const approved = await UserDBPrivate.model.count({ 'claimQueue.status': 'approved' })
      expect(approved).toEqual(2)
    })

    test('user should be preapproved by email', async () => {
      //now we test pre approved user
      const enqueueResult = await request(server)
        .post('/user/enqueue')
        .set('Authorization', `Bearer ${token}`)
        .send()

      expect(enqueueResult.body).toMatchObject({
        ok: 0,
        queue: { status: 'approved' }
      })
    })

    test('/admin/queue get request should return stats', async () => {
      let queueProps = await ClaimQueueProps.findOne({})
      if (!queueProps) {
        queueProps = new ClaimQueueProps({ value: 0 })
      }
      queueProps.value = 5
      queueProps.save()

      const res = await request(server)
        .get('/admin/queue')
        .send()

      expect(res.body).toMatchObject({
        whitelisted: 0,
        approved: 0,
        allowed: 5
      })
    })
  })
})

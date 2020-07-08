/**
 * @jest-environment node
 */

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { Mautic } from '../../mautic/mauticAPI'

describe('sendAPÏ', () => {
  let server
  beforeAll(async done => {
    const res = await Mautic.createContact({ firstname: 'h', lastname: 'r', email: 'hadartest@gooddollar.org' })
    const mauticId = res.contact.id
    //make sure fullname is set for user which is required for sending the recovery email
    await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      fullName: 'full name',
      mauticId
    })
    jest.setTimeout(30000)
    server = makeServer(done)
  })

  afterAll(done => {
    server.close(err => {
      console.log({ err })
      done()
    })
  })

  test('/send/linkemail without creds -> 401', async () => {
    await request(server)
      .post('/send/linkemail')
      .expect(401)
  })

  test('/send/linkemail with creds', async () => {
    const token = await getToken(server)
    await request(server)
      .post('/send/linkemail')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
  })

  test('/send/linksms without creds -> 401', async () => {
    await request(server)
      .post('/send/linksms')
      .expect(401)
  })

  test('/send/linksms with creds', async () => {
    const token = await getToken(server)
    await request(server)
      .post('/send/linksms')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
  })

  // test('/send/magiccode without creds -> 401', async () => {
  //   await request(server)
  //     .post('/send/magiccode')
  //     .expect(401)
  // })
  //
  // test('/send/magiccode with creds', async () => {
  //   const token = await getToken(server)
  //   await request(server)
  //     .post('/send/magiccode')
  //     .set('Authorization', `Bearer ${token}`)
  //     .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
  // })

  test('/send/recoveryinstructions with creds', async () => {
    const token = await getToken(server)

    await request(server)
      .post('/send/recoveryinstructions')
      .send({
        mnemonic: 'unit test send recovery instructions'
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1 })
  })

  test('/send/recoveryinstructions without required fields should fail', async () => {
    const token = await getToken(server)
    //make sure mauticid is unset which is required

    await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      fullName: 'full name',
      mauticId: null
    })
    const user = await UserDBPrivate.getByIdentifier('0x7ac080f6607405705aed79675789701a48c76f55')
    expect(user).toBeDefined()

    await request(server)
      .post('/send/recoveryinstructions')
      .send({
        mnemonic: 'unit test send recovery instructions'
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
  })

  test('/send/magiclink without creds -> 401', async () => {
    await request(server)
      .post('/send/magiclink')
      .expect(401)
  })

  test('/send/magiclink without required fields should ok', async () => {
    const token = await getToken(server)
    //make sure fullname is set for user which is required for sending the recovery email
    await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      fullName: 'full name',
      mauticId: null
    })

    const user = await UserDBPrivate.getByIdentifier('0x7ac080f6607405705aed79675789701a48c76f55')

    expect(user).toBeDefined()

    await request(server)
      .post('/send/magiclink')
      .send({
        magiclink: 'unit test magicLine'
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
  })
})

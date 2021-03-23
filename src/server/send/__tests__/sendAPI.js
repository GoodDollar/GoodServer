/**
 * @jest-environment node
 */

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { Mautic } from '../../mautic/mauticAPI'

describe('sendAPI', () => {
  let server

  beforeAll(async done => {
    const res = await Mautic.createContact({
      firstname: 'h',
      lastname: 'r',
      email: 'hadartest@gooddollar.org'
    }).catch(e => console.log('sendAPI test user failed:', e))

    const mauticId = res.contact.id

    //make sure fullname is set for user which is required for sending the recovery email
    await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      fullName: 'full name',
      mauticId
    })

    console.log('sendAPI: starting server')

    server = await makeServer(done)
    console.log('sendAPI: server ready', { server })
  })

  afterAll(done => {
    server.close(err => {
      console.log('sendAPI: closing server', { err })
      done()
    })
  })

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

  /*
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
  })*/
})

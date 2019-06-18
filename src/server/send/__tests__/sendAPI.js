/**
 * @jest-environment node
 */

import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import { GunDBPrivate } from '../../gun/gun-middleware'

describe('sendAPÏ', () => {
  let server
  beforeAll(done => {
    jest.setTimeout(10000)
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

  test('/send/linkemailwith creds', async () => {
    const token = await getToken(server)
    await request(server)
      .post('/send/linkemail')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production', 'staging'] } })
  })

  test('/verify/sendemail with creds', async () => {
    const token = await getToken(server)
    //make sure fullname is set for user which is required for sending the recovery email
    const user = await GunDBPrivate.usersCol
      .get('0x7ac080f6607405705aed79675789701a48c76f55')
      .putAck({ fullName: 'full name', mauticId: 3461 })
    await request(server)
      .post('/send/recoveryinstructions')
      .send({
        mnemonic: 'unit test send recovery instructions'
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: 1 })
  })

  test('/verify/sendemail without required fields should fail', async () => {
    const token = await getToken(server)
    //make sure mauticid is unset which is required
    await GunDBPrivate.usersCol
      .get('0x7ac080f6607405705aed79675789701a48c76f55')
      .get('mauticId')
      .putAck(null)
    const user = await GunDBPrivate.usersCol.get('0x7ac080f6607405705aed79675789701a48c76f55').then()
    const res = await request(server)
      .post('/send/recoveryinstructions')
      .send({
        mnemonic: 'unit test send recovery instructions'
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(400)
  })
})

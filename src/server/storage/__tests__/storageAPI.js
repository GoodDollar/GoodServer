// @flow
import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import type { UserRecord } from '../../../imports/types'
import UserDBPrivate from '../../db/mongo/user-privat-provider'

jest.setTimeout(30000)
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

  test('/user/add creds', async () => {
    const token = await getToken(server)
    const user: UserRecord = {
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      email: 'useraddtest@gooddollar.org' // required for mautic create contact
    }
    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
    expect(res).toMatchObject({ status: 200, body: { ok: 1 } })
  })

  test('/user/add creds dont update mauticId', async () => {
    const token = await getToken(server)
    const mauticId = '111'
    await UserDBPrivate.updateUser({ identifier: '0x7ac080f6607405705aed79675789701a48c76f55', mauticId: mauticId })
    const user: UserRecord = {
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      email: 'useraddtest@gooddollar.org' // required for mautic create contact
    }
    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
    expect(res).toMatchObject({ status: 200, body: { ok: 1 } })

    const mauticIdAfterAddUser = await UserDBPrivate.getUserField(
      '0x7ac080f6607405705aed79675789701a48c76f55',
      'mauticId'
    )
    expect(mauticIdAfterAddUser === mauticId).toBeTruthy()
  })

  test('/user/add false creds', async () => {
    const token = await getToken(server)
    const user: UserRecord = { identifier: '0x7ac080f6607405705aed79675789701a48c76f56' }
    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
    expect(res).toMatchObject({ status: 400 })
  })

  test('/user/delete with zoomId and bad signature', async () => {
    const token = await getToken(server)
    let res = await request(server)
      .post('/user/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({
        zoomId: 'DEc4f150b719957a2dD434C48Dff9Bc57466e764',
        zoomSignature: 'Bad signature'
      })
    expect(res).toMatchObject({ status: 400 })
  })

  test('/user/delete without zoomId ', async () => {
    const token = await getToken(server)
    let res = await request(server)
      .post('/user/delete')
      .set('Authorization', `Bearer ${token}`)
      .send()
    expect(res).toMatchObject({ status: 200 })
  })

  test('/user/delete with zoomId and good signature', async () => {
    const token = await getToken(server)
    let res = await request(server)
      .post('/user/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({
        zoomId: 'DEc4f150b719957a2dD434C48Dff9Bc57466e764',
        zoomSignature:
          '0xda0c23e71a589adfb4f29b021549371f44de105678284e4d9acecb8b670a35c63bd1e200ae9293dcca0064ae87438094df7e7db3268c47e638cdffdfe8c386a11c'
      })
    expect(res).toMatchObject({ status: 200 })
  })
})

// @flow
import request from 'supertest'
import makeServer from '../../server-test'
import { getToken } from '../../__util__/'
import type { UserRecord } from '../../../imports/types'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { generateMarketToken } from '../storageAPI'
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

  test('should generate marketToken', () => {
    const encrypted = generateMarketToken({ email: 'h@gd.org', name: 'h r' })
    expect(encrypted).toEqual(
      '62b431e8a2ddb37f7ac2f9366848e0b8d676d4e74ba3461445f2ad0c9104c49e28242ac9b5e183b841a2023d1078ea1a8ff4d270fe964ec6d69c24d94dcc80a3f7f8f53a1a79d5684fab54e1ce1572c402fe7e1c15e3080570ff930acaee4a1475b2bc51bf0b770c94d3d5de379cc857ab4dc610af05a0716d4d02b2e57921f1a7cded48b178b9d050ae2d3018859598'
    )
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

  test('/user/add with duplicated creds - should fail with error', async () => {
    const token = await getToken(server)
    const user: UserRecord = {
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      email: 'useraddtest@gooddollar.org' // required for mautic create contact
    }

    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })

    expect(res).toMatchObject({
      status: 400,
      body: { message: 'You cannot create more than 1 account with the same credentials' }
    })
  })

  test('/user/add creds dont update mauticId', async () => {
    const token = await getToken(server)
    const mauticId = '111'

    await UserDBPrivate.updateUser({
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      mauticId: mauticId,
      createdDate: null
    })

    const user: UserRecord = {
      identifier: '0x7ac080f6607405705aed79675789701a48c76f55',
      email: 'useraddtest@gooddollar.org' // required for mautic create contact
    }

    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
    expect(res).toMatchObject({ status: 200, body: { ok: 1, marketToken: expect.any(String) } })

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

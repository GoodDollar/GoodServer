// @flow
import request from 'supertest'
import makeServer from '../../server-test'
import { getToken, getCreds } from '../../__util__/'
import type { UserRecord } from '../../../imports/types'

jest.setTimeout(10000)
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

  test('/user/add false creds', async () => {
    const token = await getToken(server)
    const user: UserRecord = { identifier: '0x7ac080f6607405705aed79675789701a48c76f56' }
    let res = await request(server)
      .post('/user/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ user })
    expect(res).toMatchObject({ status: 400 })
  })

  test('/storage/login/token witout auth creds', async () => {
    let res = await request(server).get('/storage/login/token')

    expect(res.status).toBe(401)
  })

  test('/storage/login/token', async () => {
    const token = await getToken(server)

    let res = await request(server)
      .get('/storage/login/token')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})

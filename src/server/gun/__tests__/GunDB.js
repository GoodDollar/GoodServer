/**
 * @jest-environment node
 */
import { GunDB, GunDBPrivate } from '../gun-middleware'
import SEA from 'gun/sea'

const storage = new GunDB()
describe('GunDB', () => {
  beforeAll(async () => {
    await storage.init(null, 'test', 'testdb')
    await GunDBPrivate.ready
  })

  it('Should init correctly without s3', async () => {
    expect(storage.ready).resolves.toBe(true)
  })
  it('Should add user', async () => {
    let res = await storage.updateUser({ identifier: 1, fullName: 'hadar', email: 'jd@gooddollar.org' })
    expect(res).toBeTruthy()
  })

  it('Should get user', async () => {
    let res = await storage.getUser(1)
    expect(res).toMatchObject({ identifier: 1, fullName: 'hadar', email: 'jd@gooddollar.org' })
  })

  it('Should detect duplicate users', async () => {
    let res = await storage.isDupUserData({ identifier: 2, fullName: 'dany', email: 'jd@gooddollar.org' })
    expect(res).toBeTruthy()
  })
  it('Should sign attestation', async () => {
    let res = await storage.signClaim('dummykey', { passedTest: true })
    expect(res).toMatchObject({
      sig: expect.anything(),
      claim: { passedTest: true },
      issuer: { '@did': 'did:gooddollar:' + storage.user.is.pub, publicKey: storage.user.is.pub },
      subject: {
        '@did': 'did:gooddollar:dummykey',
        publicKey: 'dummykey'
      },
      issuedAt: expect.any(Date)
    })
    let msg = await SEA.verify(res.sig, storage.user.is.pub)
    expect(msg).toBeTruthy()
  })

  it('should remove gundb soul from records', async () => {
    let res = await storage.recordSanitize({ _: { '#': 'soul' } })
    expect(res).toEqual({})
  })

  it('should set private user in database', async () => {
    const res = GunDBPrivate.usersCol.get('testuser').putAck({ username: 'test' })
    expect(res).resolves.toBeDefined()
  })
})

/**
 * @jest-environment node
 */
import { GunDB } from '../gun-middleware'
import SEA from 'gun/sea'

const storage = new GunDB()
describe('GunDB', () => {
  beforeAll(async () => {
    await storage.init(null, 'test', 'testdb')
  })

  it('Should add user', async () => {
    let res = await storage.updateUser({ identifier: 1, fullName: 'hadar' })
    expect(res).toBeTruthy()
  })

  it('Should get user', async () => {
    let res = await storage.getUser(1)
    expect(res).toMatchObject({ identifier: 1, fullName: 'hadar' })
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
})

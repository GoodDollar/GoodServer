/**
 * @jest-environment node
 */
import { GunDB } from '../gun-middleware'
import SEA from 'gun/sea'

const storage = new GunDB()
describe('GunDB', () => {
  beforeAll(async () => {
    storage.init(null, 'test', 'testdb')
    await storage.ready
  })

  it('Should init correctly without s3', async () => {
    expect(storage.ready).resolves.toBe(true)
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
})

/**
 * @jest-environment node
 */
import { GunDBPublic as storage } from '../gun-middleware'
import Gun from 'gun'
import SEA from 'gun/sea'
import { sha3 } from 'web3-utils'
jest.setTimeout(10000)
describe('GunDB', () => {
  beforeAll(async () => {
    storage.init(null, 'test', 'testdb')
    await storage.ready
  })

  it('Gun and SEA should work in tests', async () => {
    const gun = Gun()
    const password = 'test'
    const uname = 'gdtest' + Math.random()
    const user = gun.user()
    let res = await new Promise((res, rej) => user.create('gdtest', 'test', res))
    // expect(res.err).toBeFalsy()
    let res2 = await new Promise((res, rej) => user.auth('gdtest', 'test', res))
    expect(res2.err).toBeFalsy()
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

  it('should add user profile to index by mobile hash', async () => {
    await storage.addUserToIndex('mobile', '972507315555', { profilePublickey: 'ABCDE' })
    const indexid = await storage.getIndexId('mobile')
    const index = await storage.getIndex('mobile')
    expect(index['_']['#']).toEqual(indexid)
    expect(index).toBeTruthy()
    expect(index).not.toHaveProperty('972507315555')
    expect(index).toHaveProperty(sha3('972507315555'))
  })

  it('should add user profile to index by email hash', async () => {
    await storage.addUserToIndex('email', 'hr@blah.com', { profilePublickey: 'ABCDE' })
    const indexid = await storage.getIndexId('email')
    const index = await storage.gun.get(indexid).then()
    expect(index).toBeTruthy()
    expect(index).not.toHaveProperty('hr@blah.com')
    expect(index).toHaveProperty(sha3('hr@blah.com'))
  })

  it('should add user profile to index by walletAddress hash', async () => {
    await storage.addUserToIndex('walletAddress', '0x05', { profilePublickey: 'ABCDE' })
    const indexid = await storage.getIndexId('walletAddress')
    const index = await storage.gun.get(indexid).then()
    expect(index).toBeTruthy()
    expect(index).not.toHaveProperty('0x05')
    expect(index).toHaveProperty(sha3('0x05'))
  })

  it('should not allow other user to update index', async () => {
    const indexid = await storage.getIndexId('walletAddress')
    storage.user.leave()
    const user = storage.gun.user()
    let res = await new Promise((res, rej) => user.create('maluser', 'test', res))
    // expect(res.err).toBeFalsy()
    let res2 = await new Promise((res, rej) => user.auth('maluser', 'test', res))
    expect(res2.err).toBeFalsy()
    let indexres = await storage.gun
      .get(indexid)
      .get('0x01')
      .putAck('ABCDEF')
      .catch(_ => false)
    expect(indexres).toEqual(false)
  })
})

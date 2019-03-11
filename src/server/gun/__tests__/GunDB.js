/**
 * @jest-environment node
 */
import { GunDB } from '../gun-middleware'
const storage = new GunDB()
describe('GunDB', () => {
  beforeAll(async () => {
    await storage.init(null, 'test', 'testdb')
  })

  it('Should add user', async () => {
    let res = await storage.updateUser({ pubkey: 1, fullName: 'hadar' })
    expect(res).toBeTruthy()
  })

  it('Should get user', async () => {
    let res = await storage.getUser(1)
    expect(res).toMatchObject({ pubkey: 1, fullName: 'hadar' })
  })
})

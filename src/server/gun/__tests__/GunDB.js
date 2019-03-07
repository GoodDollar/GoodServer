/**
 * @jest-environment node
 */
import { GunDB } from '../gun-middleware'
const storage = new GunDB()
describe('GunDB', () => {
  beforeAll(async () => {
    await storage.init(null, 'test', 'testdb')
  })
  //this test gets stuck for some reason
  afterAll(() => setTimeout(() => process.exit(1), 1000))

  it('Should add user', async () => {
    let res = storage.updateUser({ pubkey: 1, fullName: 'hadar' })
    expect(res).toBeTruthy()
  })

  it('Should get user', async () => {
    let res = await storage.getUser(1)
    expect(res).toMatchObject({ pubkey: 1, fullName: 'hadar' })
  })
})

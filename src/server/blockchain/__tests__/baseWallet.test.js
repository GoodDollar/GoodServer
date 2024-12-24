import { BaseAdminWallet } from '../BaseAdminWallet'
describe('BaseAdminWallet', () => {
  const wallet = new BaseAdminWallet()
  test('should always return true for whitelisting', async () => {
    expect(await wallet.isVerified('asdasd')).toEqual(true)
    expect(await wallet.whitelistUser('asdasd')).toEqual(true)
    expect(await wallet.removeWhitelisted('asdasd')).toEqual(true)
  })
})

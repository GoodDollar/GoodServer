import { BaseAdminWallet } from '../BaseAdminWallet'
describe('BaseAdminWallet', () => {
  const wallet = new BaseAdminWallet({ network: 'development-base' })
  test('should always return true for whitelisting', async () => {
    expect(await wallet.isVerified('asdasd')).toEqual(true)
    expect(await wallet.whitelistUser('asdasd')).toEqual(true)
    expect(await wallet.removeWhitelisted('asdasd')).toEqual(true)
  })

  test('should contracts addresses set', async () => {
    await wallet.ready
    expect(wallet.faucetContract._address).not.toBeEmpty()
    expect(wallet.proxyContract._address).not.toBeEmpty()
  })
})

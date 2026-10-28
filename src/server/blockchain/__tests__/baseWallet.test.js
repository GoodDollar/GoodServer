import { BaseAdminWallet } from '../BaseAdminWallet'
describe('BaseAdminWallet', () => {
  const wallet = new BaseAdminWallet({ network: 'development-base' })
  test('should always return true for whitelisting', async () => {
    expect(await wallet.isVerified('asdasd')).toEqual(false)
    expect(await wallet.whitelistUser('asdasd')).toEqual(true)
    expect(await wallet.removeWhitelisted('asdasd')).toEqual(true)
  })

  test('should contracts addresses set', async () => {
    await wallet.ready
    expect(wallet.faucetContract.address).not.toBeEmpty()
    expect(wallet.proxyContract.address).not.toBeEmpty()
  })
})

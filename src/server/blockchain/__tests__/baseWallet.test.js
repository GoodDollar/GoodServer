import { BaseAdminWallet } from '../BaseAdminWallet'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'

// make sure faucet is not empty for base
ContractsAddress.dapptest.SuperfluidFaucet = '0x0c86C82eb8d6a8E991bbc37C58e23344b20520a2'

describe('BaseAdminWallet', () => {
  const wallet = new BaseAdminWallet({ network: 'dapptest' })
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

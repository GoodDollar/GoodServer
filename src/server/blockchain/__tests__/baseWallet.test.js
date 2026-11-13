import { BaseAdminWallet } from '../BaseAdminWallet'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'

jest.mock('../../utils/tx-manager', () => ({
  getManager: jest.fn(() => ({ createListIfNotExists: jest.fn().mockResolvedValue() }))
}))

describe('BaseAdminWallet', () => {
  const wallet = new BaseAdminWallet({ network: 'dapptest' })

  beforeAll(() => {
    jest.spyOn(wallet, 'supportsEIP1559').mockResolvedValue(false)
    jest.spyOn(wallet, 'createClients').mockResolvedValue({
      publicClient: {
        getBalance: jest.fn().mockResolvedValue(100000000000000000000n),
        getTransactionCount: jest.fn().mockResolvedValue(0),
        readContract: jest.fn(async ({ functionName }) => (functionName === 'isAdmin' ? true : 1000000000n))
      },
      walletClient: {}
    })
  })

  afterAll(() => jest.restoreAllMocks())

  test('should always return true for whitelisting', async () => {
    expect(await wallet.isVerified('asdasd')).toEqual(false)
    expect(await wallet.whitelistUser('asdasd')).toEqual(true)
    expect(await wallet.removeWhitelisted('asdasd')).toEqual(true)
  })

  test('should contracts addresses set', async () => {
    // make sure faucet is not empty for base
    ContractsAddress.dapptest.SuperfluidFaucet = '0x0c86C82eb8d6a8E991bbc37C58e23344b20520a2'

    await expect(wallet.ready).resolves.toBe(true)
    expect(wallet.faucetContract.address).toBe(ContractsAddress.dapptest.SuperfluidFaucet)
    expect(wallet.proxyContract.address).toBe(ContractsAddress.dapptest.AdminWallet)
  })
})

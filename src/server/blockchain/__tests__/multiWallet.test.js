import Web3 from 'web3'
import MultiWallet from '../MultiWallet'
import { CeloAdminWallet } from '../CeloAdminWallet'
import { XdcAdminWallet } from '../XdcAdminWallet'
import { Web3Wallet } from '../Web3Wallet'
import conf from '../../server.config'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const web3 = new Web3()
const generateWalletAddress = () => web3.eth.accounts.create().address

const mockIdentityContract = whitelistedRoot => ({
  methods: {
    getWhitelistedRoot: () => ({ call: () => Promise.resolve(whitelistedRoot) })
  }
})

describe('MultiWallet.isConnected', () => {
  let account
  let fuseWallet
  let celoWallet
  let xdcWallet
  let multiWallet

  beforeEach(() => {
    account = generateWalletAddress()

    fuseWallet = new Web3Wallet('FuseTestWallet', conf, { network: 'development' })
    celoWallet = CeloAdminWallet({})
    xdcWallet = XdcAdminWallet({}) // never initialized, so has no identityContract

    fuseWallet.identityContract = mockIdentityContract(ADDRESS_ZERO)

    multiWallet = new MultiWallet.constructor({
      122: fuseWallet,
      42220: celoWallet,
      50: xdcWallet
    })
  })

  test('should succeed when XDC is uninitialized and Celo verifies the account', async () => {
    const warnSpy = jest.spyOn(xdcWallet.log, 'warn')

    celoWallet.identityContract = mockIdentityContract(account)

    expect(xdcWallet.identityContract).toBeUndefined()
    await expect(multiWallet.isConnected(account)).resolves.toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('identity contract unavailable'),
      expect.objectContaining({ address: account, wallet: 'XdcAdminWallet' })
    )
  })

  test('should not authorize when XDC is uninitialized and no other wallet verifies the account', async () => {
    const warnSpy = jest.spyOn(xdcWallet.log, 'warn')

    celoWallet.identityContract = mockIdentityContract(ADDRESS_ZERO)

    expect(xdcWallet.identityContract).toBeUndefined()
    await expect(multiWallet.isConnected(account)).resolves.toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('identity contract unavailable'),
      expect.objectContaining({ address: account, wallet: 'XdcAdminWallet' })
    )
  })
})

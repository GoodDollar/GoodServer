import { advanceForkTime } from './__util__/anvil.setup'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import AdminWallet from '../AdminWallet'

import txManager from '../../utils/tx-manager'

const generateWalletAddress = () => privateKeyToAccount(generatePrivateKey()).address

describe('adminwallet', () => {
  beforeAll(async () => {
    expect(await AdminWallet.ready).toBe(true)
    expect(AdminWallet.network).toBe('development-celo')
    expect(AdminWallet.publicClient.chain.id).toBe(42220)
    expect(AdminWallet.filledAddresses.length).toBeGreaterThan(0)
  })

  test('adminWallet tops an unverified wallet on the Celo fork', async () => {
    const unverifiedAddress = generateWalletAddress()
    const tx = await AdminWallet.topWallet(unverifiedAddress)
    expect(tx.status).toBe(true)
    const balance = await AdminWallet.publicClient.getBalance({ address: unverifiedAddress })
    expect(balance).toBeGreaterThan(0n)
  })

  test('adminWallet constructor works', async () => {
    expect(await AdminWallet.ready.catch(() => false)).toBeTruthy()
  })

  test('adminWallet can whitelist user', async () => {
    const unverifiedAddress = generateWalletAddress()
    await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    const isVerified = await AdminWallet.isVerified(unverifiedAddress)

    expect(isVerified).toBeTruthy()
  })

  test('adminWallet can whitelist user with chainid', async () => {
    const unverifiedAddress = generateWalletAddress()
    await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random(), 123)
    const isVerified = await AdminWallet.isVerified(unverifiedAddress)
    const registeredChainId = await AdminWallet.identityContract.read.getWhitelistedOnChainId([unverifiedAddress])
    expect(isVerified).toBeTruthy()
    expect(registeredChainId).toBe(123n)
  })

  test('adminWallet can authenticate user', async () => {
    const unverifiedAddress = generateWalletAddress()
    await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    const lastAuth = await AdminWallet.identityContract.read.lastAuthenticated([unverifiedAddress]).then(parseInt)

    await advanceForkTime(2)
    await AdminWallet.authenticateUser(unverifiedAddress)
    const lastAuth2 = await AdminWallet.identityContract.read.lastAuthenticated([unverifiedAddress]).then(parseInt)

    expect(lastAuth2).toBeGreaterThan(lastAuth)
  })

  test('adminWallet get authenticationPeriod', async () => {
    const result = await AdminWallet.getAuthenticationPeriod()
    const onChainPeriod = await AdminWallet.identityContract.read.authenticationPeriod([])
    expect(result).toBe(Number(onChainPeriod))
    expect(result).toBeGreaterThan(0)
  })

  test('adminWallet can blacklist user', async () => {
    const unverifiedAddress = generateWalletAddress()

    await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    await AdminWallet.removeWhitelisted(unverifiedAddress)

    const isVerified = await AdminWallet.isVerified(unverifiedAddress)

    expect(isVerified).not.toBeTruthy()
  })

  test('adminWallet get balance correctly', async () => {
    const balance = await AdminWallet.getBalance()

    expect(balance > 0).toBeTruthy()
  })

  test('adminWallet receive queue nonce', async () => {
    const promises = []

    for (let i = 0; i < 5; i++) {
      const unverifiedAddress = generateWalletAddress()

      promises.push(
        AdminWallet.topWallet(unverifiedAddress).then(tx => {
          expect(tx.status).toBe(true)
          return tx
        })
      )
    }

    const res = await Promise.all(promises)
    const hashes = new Set(res.map(tx => tx.transactionHash))
    const nonces = await Promise.all(
      res.map(tx => AdminWallet.publicClient.getTransaction({ hash: tx.transactionHash }).then(tx => tx.nonce))
    )

    res.forEach(tx => expect(tx.blockNumber).toEqual(expect.any(Number)))
    expect(hashes.size).toBe(5)
    const orderedNonces = nonces.sort((first, second) => first - second)
    expect(orderedNonces).toEqual(orderedNonces.map((_, index) => orderedNonces[0] + index))
  })

  test('adminWallet bad transaction in queue', async () => {
    const unverifiedAddress = generateWalletAddress()
    const unverifiedAddress2 = generateWalletAddress()

    const from = AdminWallet.address
    const testValue = 10
    const badGas = 10
    let tx

    //good tx
    tx = await AdminWallet.topWallet(unverifiedAddress)
    expect(tx).toBeTruthy()

    //bad tx
    await expect(
      AdminWallet.sendNative({
        from,
        to: unverifiedAddress,
        value: testValue,
        gas: badGas,
        gasPrice: badGas
      })
    ).rejects.toThrow()

    //good tx
    tx = await AdminWallet.topWallet(unverifiedAddress2)
    expect(tx).toBeTruthy()
  })

  test('queue Manager lock with one address', async () => {
    const unverifiedAddress = generateWalletAddress()
    const { release } = await txManager.lock(unverifiedAddress)
    await release()
  })

  test('queue Manager lock with array of addresses', async () => {
    const unverifiedAddresses = [generateWalletAddress(), generateWalletAddress()]
    const { release } = await txManager.lock(unverifiedAddresses)
    await release()
  })

  test('adminWallet init falls back to a default address instead of crashing when no wallet is funded', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {})
    const isVerifiedAdminSpy = jest.spyOn(AdminWallet, 'isVerifiedAdmin').mockResolvedValue(false)
    const previousAddresses = [...AdminWallet.addresses]
    const previousAddress = AdminWallet.address
    const previousFilledAddresses = [...AdminWallet.filledAddresses]

    try {
      // init() only sets this.address when a wallet qualifies, so clear the address the
      // real (unmocked) init from beforeAll already found before re-running it here.
      AdminWallet.address = undefined

      expect(await AdminWallet.init()).toBe(true)

      expect(AdminWallet.address).toBe(AdminWallet.addresses[0])
      expect(AdminWallet.filledAddresses).toEqual([])
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      AdminWallet.addresses = previousAddresses
      AdminWallet.address = previousAddress
      AdminWallet.filledAddresses = previousFilledAddresses
      isVerifiedAdminSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })
})

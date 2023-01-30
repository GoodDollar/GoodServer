import Web3 from 'web3'
import AdminWallet from '../AdminWallet'

import txManager from '../../utils/tx-manager'

const web3 = new Web3()
const generateWalletAddress = () => web3.eth.accounts.create().address

xdescribe('adminwallet', () => {
  beforeAll(async () => {
    await AdminWallet.ready
  })

  test(`adminWallet top wallet shouldn't throws an error when user is not whitelisted/verified`, async () => {
    const unverifiedAddress = generateWalletAddress()
    const tx = await AdminWallet.topWallet(unverifiedAddress).catch(() => false)
    expect(tx).toBeTruthy()
    const balance = await AdminWallet.web3.eth.getBalance(unverifiedAddress)
    expect(balance).toEqual('6000000000000000')
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

  test('adminWallet can authenticate user', async () => {
    const unverifiedAddress = generateWalletAddress()
    await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    const lastAuth = await AdminWallet.identityContract.methods
      .lastAuthenticated(unverifiedAddress)
      .call()
      .then(parseInt)

    await AdminWallet.authenticateUser(unverifiedAddress)
    const lastAuth2 = await AdminWallet.identityContract.methods
      .lastAuthenticated(unverifiedAddress)
      .call()
      .then(parseInt)

    expect(lastAuth2).toBeGreaterThan(lastAuth)
  })

  test('adminWallet get authenticationPeriod', async () => {
    const result = await AdminWallet.getAuthenticationPeriod()
    expect(parseInt(result)).toEqual(1095)
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
        AdminWallet.topWallet(unverifiedAddress)
          .then(tx => tx.blockNumber)
          .catch(e => e)
      )
    }

    const res = await Promise.all(promises)
    const uniqueBlocks = new Set(res)

    res.forEach(n => expect(n).toEqual(expect.any(Number))) //check it was excuted in 5 or les blocks, if ganache is set 1 sec per block it should be under 5. otherwise 5.
    expect(uniqueBlocks.size).toBeLessThanOrEqual(5)
    expect(res).toBeTruthy()
  })

  test('adminWallet bad transaction in queue', async () => {
    const unverifiedAddress = generateWalletAddress()
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
    tx = await AdminWallet.topWallet(unverifiedAddress)
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
})

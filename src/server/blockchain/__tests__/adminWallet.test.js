import AdminWallet from '../AdminWallet'
import txManager from '../../utils/tx-manager'
import Web3 from 'web3'
import delay from 'delay'

const web3 = new Web3()
const generateWalletAddress = () => web3.eth.accounts.create().address

jest.setTimeout(20000)
describe('adminwallet', () => {
  beforeAll(async () => {
    await AdminWallet.ready
  })

  test(`adminWallet top wallet shouldn't throws an error when user is not whitelisted/verified`, async () => {
    const unverifiedAddress = generateWalletAddress()
    const tx = await AdminWallet.topWallet(unverifiedAddress, null).catch(e => false)
    const balance = await AdminWallet.web3.eth.getBalance(unverifiedAddress)
    expect(balance).toEqual('1000000000000000')
    expect(tx).toBeTruthy()
  })

  test('adminWallet constructor works', async () => {
    expect(await AdminWallet.ready.catch(_ => false)).toBeTruthy()
  })

  test('adminWallet can whitelist user', async () => {
    const unverifiedAddress = generateWalletAddress()
    const tx = await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    const isVerified = await AdminWallet.isVerified(unverifiedAddress)
    expect(isVerified).toBeTruthy()
  })

  test('adminWallet can blacklist user', async () => {
    const unverifiedAddress = generateWalletAddress()
    const tx = await AdminWallet.whitelistUser(unverifiedAddress, 'did:gd' + Math.random())
    const tx2 = await AdminWallet.removeWhitelisted(unverifiedAddress)
    const isVerified = await AdminWallet.isVerified(unverifiedAddress)
    expect(isVerified).not.toBeTruthy()
  })

  test('adminWallet throws exception', async () => {
    const unverifiedAddress = '0x888185b656fe770677a91412f9f09B23A787242A'
    expect(await AdminWallet.removeWhitelisted(unverifiedAddress).catch(e => false)).toBeFalsy()
  })

  test('adminWallet get balance correctly', async () => {
    const balance = await AdminWallet.getBalance()
    expect(balance > 0).toBeTruthy()
  })

  test('adminWallet receive queue nonce', async () => {
    const promises = []
    for (let i = 0; i < 5; i++) {
      // await delay(300) //hack otherwise txes fail, looks like a web3 issue, sending txes out of order
      const unverifiedAddress = generateWalletAddress()
      promises.push(
        AdminWallet.topWallet(unverifiedAddress)
          .then(tx => tx.blockNumber)
          .catch(e => e)
      )
    }
    const res = await Promise.all(promises)
    const uniqueBlocks = new Set(res)
    res.forEach(n => expect(n).toEqual(expect.any(Number))) //check it was excuted on one or two block
    expect(uniqueBlocks.size).toBeLessThanOrEqual(2)
    expect(res).toBeTruthy()
  })

  test('adminWallet bad transaction in queue', async () => {
    const unverifiedAddress = generateWalletAddress()
    const from = AdminWallet.address
    const testValue = 10
    const badGas = 10
    let tx

    //good tx
    tx = await AdminWallet.topWallet(unverifiedAddress, null, true)
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
    tx = await AdminWallet.topWallet(unverifiedAddress, null, true)
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

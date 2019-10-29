import AdminWallet from '../AdminWallet'

jest.setTimeout(10000)
beforeAll(async () => {
  await AdminWallet.ready
})

test(`adminWallet top wallet shouldn't throws an error when user is not whitelisted/verified`, async () => {
  const unverifiedAddress = '0xC8282816Bbbb5A417762feE6e736479D4809D129'
  const blacklist = await AdminWallet.blacklistUser(unverifiedAddress)
  const tx = await AdminWallet.topWallet(unverifiedAddress, null).catch(e => false)
  expect(tx).toBeTruthy()
})

test('adminWallet constructor works', async () => {
  expect(AdminWallet.address).not.toBeNull()
})

test('adminWallet can whitelist user', async () => {
  await AdminWallet.removeWhitelisted('0x888185b656fe770677a91412f9f09B23A787242A').catch(_ => _)
  const tx = await AdminWallet.whitelistUser('0x888185b656fe770677a91412f9f09B23A787242A', 'did:gd')
  const isVerified = await AdminWallet.isVerified('0x888185b656fe770677a91412f9f09B23A787242A')
  expect(isVerified).toBeTruthy()
})

test('adminWallet can blacklist user', async () => {
  const tx = await AdminWallet.removeWhitelisted('0x888185b656fe770677a91412f9f09B23A787242A')
  const isVerified = await AdminWallet.isVerified('0x888185b656fe770677a91412f9f09B23A787242A')
  expect(isVerified).not.toBeTruthy()
})

test('adminWallet throws exception', async () => {
  await expect(AdminWallet.removeWhitelisted('0x888')).rejects.toThrow()
})

test('adminWallet get balance correctly', async () => {
  const balance = await AdminWallet.getBalance()
  expect(balance > 0).toBeTruthy()
})

test(`adminWallet top wallet shouldn't throws an error when user is not whitelisted/verified`, async () => {
  const unverifiedAddress = '0x5d1b321087c9273c7efb0815c43c019df180fa56'
  await expect(AdminWallet.topWallet(unverifiedAddress, null)).toBeTruthy()
})

test('adminWallet receive queue nonce', async () => {
  const unverifiedAddress = '0xC8282816Bbbb5A417762feE6e736479D4809D129'
  for (let i = 0; i < 5; i++) {
    let tx = await AdminWallet.topWallet(unverifiedAddress, null, true)
    expect(tx).toBeTruthy()
  }
})

test('adminWallet bad transaction in queue', async () => {
  const unverifiedAddress = '0xC8282816Bbbb5A417762feE6e736479D4809D129'
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

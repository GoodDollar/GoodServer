import AdminWallet from '../AdminWallet'

jest.setTimeout(20000)

test('adminWallet constructor works', async () => {
  expect(AdminWallet.address).not.toBeNull()
})

test('adminWallet can whitelist user', async () => {
  const tx = await AdminWallet.whitelistUser('0x888185b656fe770677a91412f9f09B23A787242A', 'did:gd')
  const isVerified = await AdminWallet.isVerified('0x888185b656fe770677a91412f9f09B23A787242A')
  expect(isVerified).toBeTruthy()
})

test('adminWallet can blacklist user', async () => {
  const tx = await AdminWallet.blacklistUser('0x888185b656fe770677a91412f9f09B23A787242A')
  const isVerified = await AdminWallet.isVerified('0x888185b656fe770677a91412f9f09B23A787242A')
  expect(isVerified).not.toBeTruthy()
})

test('adminWallet throws exception', async () => {
  await expect(AdminWallet.blacklistUser('0x888')).rejects.toThrow()
})

test('adminWallet get balance correctly', async () => {
  const balance = await AdminWallet.getBalance()
  expect(balance > 0).toBeTruthy()
})

test('adminWallet top wallet throws an error when user is not whitelisted/verified', async () => {
  const unverifiedAddress = '0xb999A6a8096dE62638f99157E5E05894303F5EA8'
  await AdminWallet.blacklistUser(unverifiedAddress)
  await expect(AdminWallet.topWallet(unverifiedAddress, null)).rejects.toThrow()
})

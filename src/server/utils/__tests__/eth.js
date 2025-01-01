import { verifyIdentifier, extractSignature, FV_IDENTIFIER_MSG2 } from '../eth.js'
import Web3 from 'web3'

const sig =
  '0x0000000000000000000000004e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000003c000000000000000000000000000000000000000000000000000000000000003241688f0b900000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000007a6733696a79300000000000000000000000000000000000000000000000000000000000000000000284b63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000038869bf66a61cf6bdb996a6ae40d5853fd43b5260000000000000000000000000000000000000000000000000000000000000140000000000000000000000000a581c4a4db7175302464ff3c06380bc3270b403700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000005d269dc41c41c2e62dd85bf8f2b05820783bfc6000000000000000000000000000000000000000000000000000000000000001048d80ff0a000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000b9018ecd4ec46d4d2a6b64fe960b3d64e8b94b2234eb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000648d0dc49f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a581c4a4db7175302464ff3c06380bc3270b403700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004112a5fb2597ee2cceeeed0c0ff4c8605183e7ce6af30f96310034e8c068ee421758508fb3a0e54287b15779a8fdf4ad1ed5fb1c78dcde9d891d96d6d51648bc6020000000000000000000000000000000000000000000000000000000000000006492649264926492649264926492649264926492649264926492649264926492'

describe('eth utils', () => {
  test('it should verify regular signature', async () => {
    const web3 = new Web3()
    let account = web3.eth.accounts.create()
    web3.eth.accounts.wallet.add(account)
    const sig = await web3.eth.sign(FV_IDENTIFIER_MSG2({ account: account.address }), account.address)
    const res = await verifyIdentifier(sig, account.address.toLowerCase())
    expect(res).toBeTrue()
  })
  test('it should verify eip 6492 signature', async () => {
    const res = await verifyIdentifier(sig, '0x2BaC1D4938Fa41fcf41B6C99baCaE66AA3C531AF')
    expect(res).toBeTrue()
  })

  test('it should extract eip 6492 signature', () => {
    expect(extractSignature(sig)).toEqual(
      '0x12a5fb2597ee2cceeeed0c0ff4c8605183e7ce6af30f96310034e8c068ee421758508fb3a0e54287b15779a8fdf4ad1ed5fb1c78dcde9d891d96d6d51648bc6020'
    )
  })
})
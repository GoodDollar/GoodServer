import { MultiWallet } from '../MultiWallet'

describe('MultiWallet', () => {
  test('selects the configured main wallet independently of object key order', () => {
    const xdcWallet = { networkId: 50 }
    const adminWallet = { networkId: 122 }
    const celoWallet = { networkId: 42220 }

    const multiWallet = new MultiWallet(
      {
        122: adminWallet,
        50: xdcWallet,
        42220: celoWallet
      },
      122
    )

    expect(multiWallet.mainWallet).toBe(adminWallet)
    expect(multiWallet.defaultChainId).toBe('122')
    expect(multiWallet.wallets).toEqual([adminWallet, xdcWallet, celoWallet])
    expect(multiWallet.otherWallets).toEqual([xdcWallet, celoWallet])
  })

  test('fails clearly when the configured main wallet is absent', () => {
    expect(() => new MultiWallet({ 50: { networkId: 50 } }, 122)).toThrow('Main wallet for chain 122 is missing')
  })
})

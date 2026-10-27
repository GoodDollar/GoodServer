jest.mock('@ambire/signature-validator', () => ({
  verifyMessage: jest.fn().mockResolvedValue(true)
}))

import { ethers } from 'ethers'
import { verifyMessage } from '@ambire/signature-validator'
import { verifyIdentifier } from '../eth'

describe('verifyIdentifier RPC fallback', () => {
  test('uses multiple default XDC RPC endpoints', async () => {
    const configuredRpc = process.env.XDC_RPC
    delete process.env.XDC_RPC

    try {
      await verifyIdentifier(`0x${'11'.repeat(65)}`, '0x0000000000000000000000000000000000000001', 50)
    } finally {
      if (configuredRpc === undefined) {
        delete process.env.XDC_RPC
      } else {
        process.env.XDC_RPC = configuredRpc
      }
    }

    const { provider } = verifyMessage.mock.calls[0][0]
    expect(provider).toBeInstanceOf(ethers.providers.FallbackProvider)
    expect(provider.providerConfigs.map(({ provider: rpc }) => rpc.connection.url)).toEqual([
      'https://rpc.xdc.org/',
      'https://erpc.xinfin.network'
    ])
  })
})

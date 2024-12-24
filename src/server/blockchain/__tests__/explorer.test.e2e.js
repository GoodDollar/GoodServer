import { getExplorerTxs, findFaucetAbuse } from '../explorer'

const query = { action: 'txlist', sort: 'desc', offset: 200 }

describe('explorer', () => {
  test.skip('should fetch from base', async () => {
    const txList = await getExplorerTxs('0x2CeADe86A04e474F3cf9BD87208514d818010627', 8453, query, undefined, false)
    expect(txList.length > 0)
    const abuse = await findFaucetAbuse('0x2CeADe86A04e474F3cf9BD87208514d818010627', 8453)
    expect(abuse).not.toBeEmpty()
  })
  test.skip('should fetch from celo', async () => {
    const txList = await getExplorerTxs('0x2CeADe86A04e474F3cf9BD87208514d818010627', 42220, query, undefined, false)
    expect(txList.length > 0)
  })
  test.skip('should fetch from fuse', async () => {
    const txList = await getExplorerTxs('0x2CeADe86A04e474F3cf9BD87208514d818010627', 122, query, undefined, false)
    expect(txList.length > 0)
  })
})

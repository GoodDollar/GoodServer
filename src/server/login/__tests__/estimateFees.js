import estimateAxelarFees from '../estimateAxelarFees'

describe('estimateAxelarFees', () => {
  test('passes gas limit and token symbol in the Axelar SDK argument order', async () => {
    const axlApi = {
      estimateGasFee: jest
        .fn()
        .mockResolvedValueOnce('1000000000000000000')
        .mockResolvedValueOnce('2000000000000000000')
    }

    await expect(estimateAxelarFees(axlApi)).resolves.toEqual({
      axlCeloEth: 1,
      axlEthCelo: 2
    })
    expect(axlApi.estimateGasFee).toHaveBeenNthCalledWith(1, 'Celo', 'Ethereum', '300000', 1.1, 'CELO')
    expect(axlApi.estimateGasFee).toHaveBeenNthCalledWith(2, 'Ethereum', 'Celo', '300000', 1.1, 'ETH')
  })
})

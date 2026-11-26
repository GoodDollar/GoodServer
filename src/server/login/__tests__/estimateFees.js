import estimateAxelarFees from '../estimateAxelarFees'
import { AxelarQueryAPI, EvmChain, GasToken } from '@axelar-network/axelarjs-sdk'

const dummyExecuteData =
  '0x000000000000000000000000111111111111111111111111111111111111111100000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000000000000000003039'
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
    expect(axlApi.estimateGasFee).toHaveBeenNthCalledWith(
      1,
      EvmChain.CELO,
      EvmChain.ETHEREUM,
      '300000',
      1.1,
      GasToken.CELO,
      undefined,
      dummyExecuteData
    )
    expect(axlApi.estimateGasFee).toHaveBeenNthCalledWith(
      2,
      EvmChain.ETHEREUM,
      EvmChain.CELO,
      '300000',
      1.1,
      GasToken.ETH,
      undefined,
      dummyExecuteData
    )
  })

  test('real test using non mocked axelar  api call works', async () => {
    const axlApi = new AxelarQueryAPI({ environment: 'mainnet' })
    await expect(estimateAxelarFees(axlApi)).resolves.toBeDefined()
  })
})

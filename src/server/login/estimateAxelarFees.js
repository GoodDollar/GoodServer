import { EvmChain, GasToken } from '@axelar-network/axelarjs-sdk'
import { encodeAbiParameters, parseAbiParameters, parseUnits } from 'viem'
const dummyExecuteData = encodeAbiParameters(parseAbiParameters('address, address, uint256, uint256'), [
  '0x1111111111111111111111111111111111111111', // address 1
  '0x2222222222222222222222222222222222222222', // address 2
  parseUnits('100', 18), // uint256 1
  12345n // uint256 2
])
const estimateAxelarFees = async axlApi => {
  // just to estimate gas fees

  const [celoToEth, ethToCelo] = await Promise.all([
    axlApi.estimateGasFee(EvmChain.CELO, EvmChain.ETHEREUM, '300000', 1.1, GasToken.CELO, undefined, dummyExecuteData),
    axlApi.estimateGasFee(EvmChain.ETHEREUM, EvmChain.CELO, '300000', 1.1, GasToken.ETH, undefined, dummyExecuteData)
  ])

  return {
    axlCeloEth: celoToEth / 1e18,
    axlEthCelo: ethToCelo / 1e18
  }
}

export default estimateAxelarFees

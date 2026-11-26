const estimateAxelarFees = async axlApi => {
  const [celoToEth, ethToCelo] = await Promise.all([
    axlApi.estimateGasFee('Celo', 'Ethereum', '300000', 1.1, 'CELO'),
    axlApi.estimateGasFee('Ethereum', 'Celo', '300000', 1.1, 'ETH')
  ])

  return {
    axlCeloEth: celoToEth / 1e18,
    axlEthCelo: ethToCelo / 1e18
  }
}

export default estimateAxelarFees

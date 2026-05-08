jest.mock('../../db/mongo-db')

import { Web3Wallet } from '../Web3Wallet'

const createTestWallet = options =>
  new Web3Wallet(
    'TestWallet',
    {
      env: 'test',
      mnemonic: '',
      network: 'test',
      kmsEnabled: false,
      fuse: {
        network_id: 42220,
        httpWeb3Provider: 'http://localhost:8545'
      }
    },
    {
      ethereum: {
        network_id: 42220,
        httpWeb3Provider: 'http://localhost:8545'
      },
      network: 'test-celo',
      ...options
    },
    false
  )

describe('Web3Wallet gas pricing', () => {
  const logger = {
    debug: jest.fn(),
    warn: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('prefers provider EIP-1559 fees when they are above configured floors', async () => {
    const wallet = createTestWallet({
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '1000000000'
    })

    wallet.supportsEIP1559 = jest.fn().mockResolvedValue(true)
    wallet.getFeeEstimates = jest.fn().mockResolvedValue({
      baseFee: 52000000000,
      priorityFee: 2000000000
    })

    const gas = await wallet.normalizeGasPricing({}, logger)

    expect(gas).toEqual({
      gasPrice: undefined,
      maxFeePerGas: 52000000000,
      maxPriorityFeePerGas: 2000000000
    })
  })

  test('uses configured floors when provider underbids Celo fees', async () => {
    const wallet = createTestWallet({
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '1000000000'
    })

    wallet.supportsEIP1559 = jest.fn().mockResolvedValue(true)
    wallet.getFeeEstimates = jest.fn().mockResolvedValue({
      baseFee: 30000000000,
      priorityFee: 200000000
    })

    const gas = await wallet.normalizeGasPricing({}, logger)

    expect(gas).toEqual({
      gasPrice: undefined,
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '1000000000'
    })
  })

  test('falls back to configured floors when fee estimation fails', async () => {
    const wallet = createTestWallet({
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '1000000000'
    })

    wallet.supportsEIP1559 = jest.fn().mockResolvedValue(true)
    wallet.getFeeEstimates = jest.fn().mockRejectedValue(new Error('rpc failure'))

    const gas = await wallet.normalizeGasPricing({}, logger)

    expect(gas).toEqual({
      gasPrice: undefined,
      maxFeePerGas: '40000000000',
      maxPriorityFeePerGas: '1000000000'
    })
    expect(logger.warn).toHaveBeenCalledWith('Failed to estimate EIP-1559 fees, falling back to configured values', {
      error: 'rpc failure',
      network: 'test-celo',
      networkId: 42220
    })
  })
})

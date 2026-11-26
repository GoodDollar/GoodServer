import setupLoginRoutes from '../login-middleware'
import estimateAxelarFees from '../estimateAxelarFees'
import MultiWallet from '../../blockchain/MultiWallet'
import { encodePacked } from 'viem'

jest.mock('@axelar-network/axelarjs-sdk', () => ({
  AxelarQueryAPI: jest.fn(() => ({}))
}))

jest.mock('../estimateAxelarFees', () => jest.fn())

jest.mock('../../utils/requestRateLimiter', () => jest.fn(() => (req, res, next) => next()))

jest.mock('../../db/mongo/user-privat-provider', () => ({
  __esModule: true,
  default: {
    getUser: jest.fn().mockResolvedValue(null),
    updateUser: jest.fn()
  }
}))

jest.mock('../../blockchain/MultiWallet', () => ({
  __esModule: true,
  default: {
    ready: Promise.resolve([]),
    mainWallet: {
      networkIdMainnet: 1,
      mainnetPublicClient: { readContract: jest.fn() }
    },
    walletsMap: {
      122: { publicClient: { readContract: jest.fn() } },
      42220: { publicClient: { readContract: jest.fn() } },
      50: { publicClient: { readContract: jest.fn() } }
    }
  }
}))

describe('GET /bridge/estimatefees', () => {
  let routeHandler
  const readContracts = [
    () => MultiWallet.mainWallet.mainnetPublicClient.readContract,
    () => MultiWallet.walletsMap[122].publicClient.readContract,
    () => MultiWallet.walletsMap[42220].publicClient.readContract,
    () => MultiWallet.walletsMap[50].publicClient.readContract
  ]

  beforeAll(() => {
    const routes = {}
    const app = {
      use: jest.fn(),
      get: jest.fn((path, ...handlers) => {
        routes[path] = handlers
      }),
      post: jest.fn()
    }
    setupLoginRoutes(app)
    routeHandler = routes['/bridge/estimatefees'].at(-1)
  })

  beforeEach(() => {
    readContracts.forEach(getReadContract => {
      getReadContract().mockReset().mockResolvedValue([1000000000000000000n, 0n])
    })
    estimateAxelarFees.mockResolvedValue({
      axlCeloEth: 1,
      axlEthCelo: 2
    })
  })

  test('returns Axelar and LayerZero fee estimates', async () => {
    const json = jest.fn()
    const next = jest.fn()

    routeHandler({ log: {} }, { json }, next)
    await new Promise(resolve => setImmediate(resolve))

    expect(next).not.toHaveBeenCalled()
    expect(json).toHaveBeenCalledWith({
      AXELAR: {
        AXL_CELO_TO_ETH: '1 Celo',
        AXL_ETH_TO_CELO: '2 ETH'
      },
      LAYERZERO: expect.objectContaining({
        LZ_ETH_TO_FUSE: '1 ETH',
        LZ_FUSE_TO_ETH: '1 Fuse',
        LZ_CELO_TO_XDC: '1 Celo',
        LZ_XDC_TO_CELO: '1 XDC'
      })
    })
    expect(readContracts[0]()).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'estimateSendFee',
        args: [
          expect.any(Number),
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          0n,
          false,
          encodePacked(['uint16', 'uint256'], [1, 400000n])
        ]
      })
    )
    readContracts.forEach(getReadContract => expect(getReadContract()).toHaveBeenCalledTimes(3))
  })

  test('returns null for LayerZero routes whose fee estimation fails', async () => {
    readContracts[0]().mockRejectedValueOnce(new Error('provider unavailable'))
    const json = jest.fn()

    routeHandler({ log: {} }, { json }, jest.fn())
    await new Promise(resolve => setImmediate(resolve))

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        LAYERZERO: expect.objectContaining({
          LZ_ETH_TO_FUSE: null
        })
      })
    )
  })
})

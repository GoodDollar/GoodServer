import express from 'express'
import request from 'supertest'
import { createViemFallbackClient } from '@goodwidget/core/viemFallbackClient'
import * as viemChains from 'viem/chains'

jest.mock('../../db/mongo/user-privat-provider', () => ({
  __esModule: true,
  default: {
    getUser: jest.fn().mockResolvedValue(null),
    updateUser: jest.fn()
  }
}))

describe('GET /bridge/estimatefees live integration', () => {
  jest.setTimeout(120000)

  let app

  beforeAll(async () => {
    jest.resetModules()
    const rpcCache = new Map()
    const createPublicClient = chainId => {
      const chain = Object.values(viemChains).find(candidate => candidate.id === chainId)
      const clientFactory = createViemFallbackClient(
        {
          get: key => rpcCache.get(key),
          put: (key, value) => rpcCache.set(key, value)
        },
        {
          chainIds: [chainId],
          rank: false
        }
      )

      return clientFactory.createPublicClient({ chain })
    }
    const [ethClient, fuseClient, celoClient, xdcClient] = await Promise.all([
      createPublicClient(1),
      createPublicClient(122),
      createPublicClient(42220),
      createPublicClient(50)
    ])
    const multiWallet = {
      ready: Promise.resolve([]),
      mainWallet: {
        networkIdMainnet: 1,
        mainnetPublicClient: ethClient
      },
      walletsMap: {
        122: { publicClient: fuseClient },
        42220: { publicClient: celoClient },
        50: { publicClient: xdcClient }
      }
    }

    jest.doMock('../../blockchain/MultiWallet', () => ({
      __esModule: true,
      default: multiWallet
    }))
    const setupLoginRoutes = require('../login-middleware').default

    app = express()
    setupLoginRoutes(app)
  })

  test('returns real Axelar and LayerZero fee estimates', async () => {
    const response = await request(app).get('/bridge/estimatefees')
    const body = response.body

    expect(response.status).toBe(200)
    expect(body).toEqual({
      AXELAR: expect.objectContaining({
        AXL_CELO_TO_ETH: expect.any(String),
        AXL_ETH_TO_CELO: expect.any(String)
      }),
      LAYERZERO: expect.objectContaining({})
    })
    expect(Object.keys(body.LAYERZERO)).toHaveLength(12)
    for (const fee of Object.values(body.LAYERZERO)) {
      expect(fee).toEqual(expect.stringMatching(/^\d+(?:\.\d+)? (?:ETH|Fuse|Celo|XDC)$/))
      expect(Number.parseFloat(fee)).toBeGreaterThan(0)
    }
  })
})

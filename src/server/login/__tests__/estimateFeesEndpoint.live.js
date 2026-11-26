import express from 'express'
import request from 'supertest'

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

  beforeAll(() => {
    jest.resetModules()
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

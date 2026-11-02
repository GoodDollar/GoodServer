// prevent MongoDB connection on import (see src/server/db/__mocks__/mongo-db.js)
jest.mock('../../db/mongo-db')
jest.mock('../../../imports/slack', () => ({ sendSlackAlert: jest.fn() }))

import http from 'http'
import Web3 from 'web3'
import { sendSlackAlert } from '../../../imports/slack'
import MultiWallet from '../MultiWallet'
import { Web3Wallet } from '../Web3Wallet'
import { MultipleHttpProvider } from '../transport'
import conf from '../../server.config'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const web3 = new Web3()
const generateWalletAddress = () => web3.eth.accounts.create().address

const mockIdentityContract = whitelistedRoot => ({
  methods: {
    getWhitelistedRoot: () => ({ call: () => Promise.resolve(whitelistedRoot) })
  }
})

// minimal json-rpc server; `handler` returns the json-rpc response fields for a request
const startRpcServer = handler =>
  new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = ''

      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        const { id, jsonrpc } = JSON.parse(body)

        server.requests += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id, jsonrpc, ...handler() }))
      })
    })

    server.requests = 0
    server.listen(0, '127.0.0.1', () => {
      server.url = `http://127.0.0.1:${server.address().port}/`
      resolve(server)
    })
  })

const rateLimited = () => ({ error: { code: -32005, message: 'too many requests, rate limit exceeded' } })
const chainId = () => ({ result: '0x32' })

describe('Web3Wallet RPC endpoint fallback', () => {
  const servers = []

  afterAll(() => Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))))

  const createWallet = httpWeb3Provider =>
    new Web3Wallet('XdcAdminWallet', conf, {
      ethereum: { network_id: 50, web3Transport: 'HttpProvider', httpWeb3Provider }
    })

  test('should use all configured endpoints and fall back from a rate-limited one', async () => {
    const limitedServer = await startRpcServer(rateLimited)
    const healthyServer = await startRpcServer(chainId)

    servers.push(limitedServer, healthyServer)

    const wallet = createWallet(`${limitedServer.url},${healthyServer.url}`)
    const provider = wallet.getWeb3TransportProvider()

    expect(provider).toBeInstanceOf(MultipleHttpProvider)
    expect(provider.endpoints.map(_ => _.provider)).toEqual([limitedServer.url, healthyServer.url])

    await expect(new Web3(provider).eth.getChainId()).resolves.toBe(50)
    expect(limitedServer.requests).toBeGreaterThan(0)
    expect(healthyServer.requests).toBeGreaterThan(0)

    // only the rate-limited endpoint is temporarily removed, next calls go straight to the healthy one
    expect(provider.endpoints.map(_ => _.provider)).toEqual([healthyServer.url])

    const limitedRequests = limitedServer.requests

    await expect(new Web3(provider).eth.getChainId()).resolves.toBe(50)
    expect(limitedServer.requests).toBe(limitedRequests)
  })
})

describe('Web3Wallet initialization retry', () => {
  const createWallet = (name, networkId) =>
    new Web3Wallet(name, conf, {
      ethereum: { ...conf.fuse, network_id: networkId },
      initRetryDelay: 20
    })

  beforeEach(() => {
    sendSlackAlert.mockClear()
  })

  test('should recover on a later initialization attempt', async () => {
    const wallet = createWallet('XdcAdminWallet', 50)
    const initSpy = jest
      .spyOn(wallet, 'init')
      .mockRejectedValueOnce(new Error('too many requests'))
      .mockResolvedValueOnce(true)

    // concurrent callers share the same in-flight initialization
    const results = await Promise.all([wallet.ready, wallet.ready])

    expect(results).toEqual([true, true])
    expect(initSpy).toHaveBeenCalledTimes(2)
    expect(sendSlackAlert).not.toHaveBeenCalled()

    // successful result is cached, no further attempts
    await expect(wallet.ready).resolves.toBe(true)
    expect(initSpy).toHaveBeenCalledTimes(2)
  })

  test('should alert once after 3 failed attempts while a healthy chain remains usable', async () => {
    const account = generateWalletAddress()
    const fuseWallet = createWallet('AdminWallet', 122)
    const celoWallet = createWallet('CeloAdminWallet', 42220)
    const xdcWallet = createWallet('XdcAdminWallet', 50)
    const multiWallet = new MultiWallet.constructor({ 122: fuseWallet, 42220: celoWallet, 50: xdcWallet })

    fuseWallet.identityContract = mockIdentityContract(ADDRESS_ZERO)

    jest.spyOn(celoWallet, 'init').mockImplementation(async () => {
      celoWallet.identityContract = mockIdentityContract(account)
      return true
    })

    const rpcUrl = new URL('https://rpc.xdc.org/apikey123?token=abc')

    rpcUrl.username = 'user'
    rpcUrl.password = 'secret'

    const xdcInitSpy = jest
      .spyOn(xdcWallet, 'init')
      .mockRejectedValue(new Error(`too many requests from ${rpcUrl.href}`))

    const xdcReady = xdcWallet.ready

    // healthy chain is initialized and usable while xdc is still retrying
    await expect(celoWallet.ready).resolves.toBe(true)
    expect(xdcInitSpy.mock.calls.length).toBeLessThan(3)
    await expect(multiWallet.isConnected(account)).resolves.toBe(true)

    await expect(xdcReady).resolves.toBe(false)
    expect(xdcInitSpy).toHaveBeenCalledTimes(3)
    expect(xdcWallet.identityContract).toBeUndefined()

    expect(sendSlackAlert).toHaveBeenCalledTimes(1)

    const [[alert]] = sendSlackAlert.mock.calls

    expect(alert).toMatchObject({ wallet: 'XdcAdminWallet', networkId: 50 })
    expect(alert.msg).toContain('XdcAdminWallet')
    expect(alert.error).toContain('https://rpc.xdc.org')
    expect(JSON.stringify(alert)).not.toMatch(/secret|apikey123|token=abc/)

    // failed result isn't cached: a later call starts a new bounded cycle, without alerting again
    await expect(xdcWallet.ready).resolves.toBe(false)
    expect(xdcInitSpy).toHaveBeenCalledTimes(6)
    expect(sendSlackAlert).toHaveBeenCalledTimes(1)

    // xdc stays unavailable without breaking the shared verification check
    await expect(multiWallet.isConnected(account)).resolves.toBe(true)
  })
})

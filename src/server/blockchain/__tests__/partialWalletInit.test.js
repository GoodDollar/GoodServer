jest.mock('../../db/mongo-db')
jest.mock('../../../imports/slack', () => ({ sendSlackAlert: jest.fn() }))
jest.mock('../../utils/tx-manager', () => ({
  getManager: () => ({ createListIfNotExists: jest.fn().mockResolvedValue() })
}))
jest.mock('web3', () => Object.assign(jest.fn(), { providers: jest.requireActual('web3').providers }))

import Web3 from 'web3'
import MultiWallet from '../MultiWallet'
import { Web3Wallet } from '../Web3Wallet'
import conf from '../../server.config'

const ZERO = '0x0000000000000000000000000000000000000000'
const account = '0x1111111111111111111111111111111111111111'
const identity = root => ({ methods: { getWhitelistedRoot: () => ({ call: () => Promise.resolve(root) }) } })

test('late initialization failure cannot interfere with or authorize verification', async () => {
  let rejectBalance
  let signalLateBalance
  const lateBalance = new Promise(resolve => {
    signalLateBalance = resolve
  })
  const failedBalance = new Promise((resolve, reject) => {
    rejectBalance = reject
  })
  const getBalance = jest
    .fn()
    .mockResolvedValue('1000000000000000000')
    .mockImplementationOnce(() => Promise.resolve('1000000000000000000'))
    .mockImplementationOnce(() => Promise.resolve('1000000000000000000'))
    .mockImplementationOnce(() => Promise.resolve('1000000000000000000'))
    .mockImplementationOnce(() => {
      signalLateBalance()
      return failedBalance
    })
  const contract = jest.fn().mockImplementation(() => ({
    methods: {
      adminToppingAmount: () => ({ call: () => Promise.resolve('0') }),
      getWhitelistedRoot: () => ({ call: () => Promise.reject(new Error('XDC unavailable')) })
    }
  }))
  Web3.mockImplementation(() => ({
    eth: {
      getBalance,
      getTransactionCount: jest.fn().mockResolvedValue(0),
      Contract: contract,
      accounts: { privateKeyToAccount: () => ({ address: account }), wallet: { add: jest.fn() } }
    }
  }))

  const options = { network: 'production-xdc', ethereum: { network_id: 50 }, initRetryDelay: 0 }
  const xdc = new Web3Wallet(
    'XdcAdminWallet',
    { ...conf, env: 'test', mnemonic: null, privateKey: '0x01', topAdminsOnStartup: false },
    options,
    false
  )
  const celo = new Web3Wallet('CeloAdminWallet', { ...conf, env: 'test' }, options, false)
  celo.identityContract = identity(account)
  xdc.identityContract = identity(account) // stale result from a previous initialization
  const multi = new MultiWallet.constructor({ 50: xdc, 42220: celo })
  jest.spyOn(xdc, 'getWeb3TransportProvider').mockReturnValue({})
  jest.spyOn(xdc, 'supportsEIP1559').mockResolvedValue(true)
  jest.spyOn(xdc, 'isVerifiedAdmin').mockResolvedValue(true)

  const ready = xdc.ready
  await lateBalance
  expect(contract.mock.calls.length).toBeGreaterThanOrEqual(3)
  expect(xdc.identityContract).toBeUndefined()
  await expect(multi.isConnected(account)).resolves.toBe(true)
  rejectBalance(new Error('late RPC failure'))
  // The subsequent attempts fail earlier, before creating contracts.
  getBalance.mockImplementation(() => Promise.reject(new Error('RPC unavailable')))
  await expect(ready).resolves.toBe(false)
  await expect(multi.isConnected(account)).resolves.toBe(true)
  celo.identityContract = identity(ZERO)
  await expect(multi.isConnected(account)).resolves.toBe(false)

  // A later successful initialization publishes XDC's identity for verification.
  getBalance.mockResolvedValue('1000000000000000000')
  contract.mockImplementation(() => ({
    methods: {
      adminToppingAmount: () => ({ call: () => Promise.resolve('0') }),
      getWhitelistedRoot: () => ({ call: () => Promise.resolve(account) })
    }
  }))
  await expect(xdc.ready).resolves.toBe(true)
  await expect(multi.isConnected(account)).resolves.toBe(true)
})

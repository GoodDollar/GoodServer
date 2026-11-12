import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import { Web3Wallet } from '../../Web3Wallet'
import { createAnvilFork } from './anvil'
import { startAnvil } from './anvil.node.cjs'
import conf from '../../../server.config'

jest.setTimeout(120000)

jest.mock('../../../server.config', () => {
  const { generatePrivateKey } = require('viem/accounts')
  const ethereum = { network_id: 42220, httpWeb3Provider: process.env.CELO_FORK_RPC_URL }
  return {
    env: 'test',
    network: 'development-celo',
    fuse: ethereum,
    celo: ethereum,
    ethereumMainnet: ethereum,
    privateKey: generatePrivateKey(),
    numberOfAdminWalletAccounts: 1,
    adminMinBalance: 1000000,
    maxGasPrice: 100,
    enableMongoLock: false,
    topAdminsOnStartup: false,
    enableWhitelistAtChain: true,
    forceFaucetCall: false,
    kmsEnabled: false,
    kmsKeyIds: process.env.KMS_KEY_IDS,
    kmsKeysTag: process.env.KMS_KEYS_TAG,
    kmsRegion: process.env.AWS_REGION
  }
})
jest.mock('../../../db/mongo-db')
jest.mock('../../../../imports/slack', () => ({ sendSlackAlert: jest.fn() }))
jest.mock('../../../../imports/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() }
  return { ...log, child: () => log }
})

let fork, anvil, clientsSpy, adminSpy

beforeAll(async () => {
  let rpcUrl = process.env.CELO_FORK_RPC_URL
  if (!rpcUrl) {
    anvil = await startAnvil({
      archiveRpcUrl: process.env.CELO_ARCHIVE_RPC_URL ?? 'https://forno.celo.org',
      blockNumber: process.env.CELO_FORK_BLOCK_NUMBER ?? '82495167'
    })
    rpcUrl = anvil.rpcUrl
  }
  conf.fuse.httpWeb3Provider = rpcUrl
  fork = createAnvilFork({
    rpcUrl,
    deployment: ContractsAddress['development-celo'],
    owner: process.env.CELO_FORK_OWNER
  })
  await fork.initialize()
  clientsSpy = jest.spyOn(Web3Wallet.prototype, 'createClients').mockImplementation(async function () {
    const fees = await fork.publicClient.estimateFeesPerGas()
    this.maxFeePerGas = fees.maxFeePerGas
    this.maxPriorityFeePerGas = fees.maxPriorityFeePerGas
    return { publicClient: fork.publicClient, walletClient: fork.walletClient }
  })
  const isVerifiedAdmin = Web3Wallet.prototype.isVerifiedAdmin
  const preparedWallets = new WeakMap()
  adminSpy = jest.spyOn(Web3Wallet.prototype, 'isVerifiedAdmin').mockImplementation(async function (address) {
    if (!preparedWallets.has(this)) preparedWallets.set(this, fork.prepareAccounts(this.addresses))
    await preparedWallets.get(this)
    return isVerifiedAdmin.call(this, address)
  })
}, 120000)

afterAll(async () => {
  clientsSpy?.mockRestore()
  adminSpy?.mockRestore()
  try {
    await fork?.restore()
  } finally {
    await anvil?.stop()
  }
}, 30000)

export const advanceForkTime = async seconds => {
  await fork.publicClient.request({ method: 'evm_increaseTime', params: [seconds] })
  await fork.publicClient.request({ method: 'evm_mine', params: [] })
}

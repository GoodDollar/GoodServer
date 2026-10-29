// @flow
import Crypto from 'crypto'
// import viemFallbackClient directly to prevent other packages from being imported inadvertently
import { createViemFallbackClient } from '@goodwidget/core/viemFallbackClient'
import { defineChain, encodeFunctionData, formatEther, formatUnits, getContract } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as chains from 'viem/chains'
import HDKey from 'hdkey'
import bip39 from 'bip39-light'
import get from 'lodash/get'
import assign from 'lodash/assign'
import chunk from 'lodash/chunk'
import IdentityABI from '@gooddollar/goodprotocol/artifacts/contracts/identity/IdentityV2.sol/IdentityV2.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.min.json'
import UBIABI from '@gooddollar/goodprotocol/artifacts/contracts/ubi/UBIScheme.sol/UBIScheme.json'
import ProxyContractABI from '@gooddollar/goodprotocol/artifacts/contracts/utils/AdminWalletFuse.sol/AdminWalletFuse.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import FaucetABI from '@gooddollar/goodprotocol/artifacts/contracts/fuseFaucet/FuseFaucetV2.sol/FuseFaucetV2.json'
import BuyGDFactoryABI from '@gooddollar/goodprotocol/artifacts/abis/BuyGDCloneFactory.min.json'
import BuyGDABI from '@gooddollar/goodprotocol/artifacts/abis/BuyGDCloneV2.min.json'

import conf from '../server.config'
import logger from '../../imports/logger'
import { retry as retryAsync, withTimeout } from '../utils/async'
import { type TransactionReceipt } from './blockchain-types'

import { getManager } from '../utils/tx-manager'
import { sendSlackAlert } from '../../imports/slack'
import { KMSWallet } from './KMSWallet'
// import { HttpProviderFactory, WebsocketProvider } from './transport'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const FUSE_TX_TIMEOUT = 25000 // should be confirmed after max 5 blocks (25sec)
const rpcCache = new Map()

//extend admin abi with genericcallbatch
const AdminWalletABI = [
  ...ProxyContractABI.abi,
  {
    inputs: [
      {
        internalType: 'address[]',
        name: '_contracts',
        type: 'address[]'
      },
      {
        internalType: 'bytes[]',
        name: '_datas',
        type: 'bytes[]'
      },
      {
        internalType: 'uint256[]',
        name: '_values',
        type: 'uint256[]'
      }
    ],
    name: 'genericCallBatch',
    outputs: [
      {
        internalType: 'bool',
        name: 'success',
        type: 'bool'
      },
      {
        internalType: 'bytes',
        name: 'returnValue',
        type: 'bytes'
      }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]
export const adminMinBalance = conf.adminMinBalance

export const forceUserToUseFaucet = conf.forceFaucetCall

export const defaultGas = 500000

/**
 * Exported as AdminWallet
 * Interface with blockchain contracts through GoodWidget's viem fallback clients.
 */
export class Web3Wallet {
  // defining vars here breaks "inheritance"
  get ready() {
    return this.initialize()
  }

  constructor(name, conf, options = null, useKMS = conf.kmsEnabled) {
    const {
      ethereum = null,
      network = null,
      maxFeePerGas = undefined,
      maxPriorityFeePerGas = undefined,
      faucetTxCost = 150000,
      gasPrice = undefined
    } = options || {}
    const ethOpts = ethereum || conf.fuse
    const { network_id: networkId } = ethOpts

    this.useKMS = useKMS
    this.faucetTxCost = faucetTxCost
    this.name = name
    this.addresses = []
    this.filledAddresses = []
    this.wallets = {}
    this.conf = conf
    this.mnemonic = conf.mnemonic
    this.network = network || conf.network
    this.ethereum = ethOpts
    this.networkId = networkId
    this.maxFeePerGas = maxFeePerGas
    this.maxPriorityFeePerGas = maxPriorityFeePerGas
    this.gasPrice = gasPrice
    this.log = logger.child({ from: `${name}/${this.networkId}` })
    this.kmsWallet = null // Will be initialized if KMS is used
    this._supportsEIP1559 = null // Cached EIP-1559 support check result

    // Skip automatic initialization in test environment to prevent async operations
    // from running after Jest tears down the test environment
    if (this.conf.env !== 'test') {
      this.initialize()
    }
  }

  async initialize() {
    let { _readyPromise } = this

    if (!_readyPromise) {
      _readyPromise = this.init()
      assign(this, { _readyPromise })
    }

    return _readyPromise
  }

  async createClients(ethereum = this.ethereum) {
    const chainId = Number(ethereum.network_id)
    const rpcUrls = (ethereum.httpWeb3Provider || '')
      .split(',')
      .map(url => url.trim())
      .filter(Boolean)
    const chain =
      Object.values(chains).find(candidate => candidate.id === chainId) ||
      defineChain({
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'Native', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: rpcUrls } }
      })
    const clientFactory = createViemFallbackClient(
      {
        get: key => rpcCache.get(key),
        put: (key, value) => {
          rpcCache.set(key, value)
        }
      },
      {
        chainIds: [chainId],
        rank: false,
        onError: error => this.log.warn('RPC discovery failed', { error: error.message })
      }
    )

    const clientOptions = { chain, fallbackRpcs: rpcUrls }
    const publicClient = await clientFactory.createPublicClient(clientOptions)
    const walletClient = await clientFactory.createWalletClient(clientOptions)
    return { publicClient, walletClient }
  }

  getContract(abi, address, publicClient = this.publicClient) {
    return getContract({ abi, address, client: publicClient })
  }

  contractTransaction(contract, functionName, args = []) {
    return { to: contract.address, data: encodeFunctionData({ abi: contract.abi, functionName, args }) }
  }

  async _sendViemTransaction(tx, address, txParams, txCallbacks = {}, context = {}, clients = this) {
    const { publicClient, walletClient } = clients
    const { release = () => {}, onTxHash = () => {}, timeout = FUSE_TX_TIMEOUT } = context
    const params = { ...tx, ...txParams, account: this.wallets[address.toLowerCase()] }
    for (const key of ['gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value']) {
      if (params[key] !== undefined && params[key] !== null) params[key] = BigInt(params[key])
    }
    try {
      let hash
      if (this.isKMSWallet(address)) {
        const signedTx = await this._signTransactionWithKMS(tx, address, {
          ...params,
          chainId: publicClient.chain.id
        })
        hash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx })
      } else {
        if (!params.account) throw new Error(`No signing account configured for ${address}`)
        hash = await walletClient.sendTransaction(params)
      }
      onTxHash(hash)
      release()
      if (txCallbacks.onTransactionHash) txCallbacks.onTransactionHash(hash)
      const result = await publicClient.waitForTransactionReceipt({ hash, timeout })
      const receipt = {
        ...result,
        status: result.status === 'success',
        blockNumber: Number(result.blockNumber),
        gasUsed: Number(result.gasUsed),
        cumulativeGasUsed: Number(result.cumulativeGasUsed),
        effectiveGasPrice: result.effectiveGasPrice?.toString()
      }
      if (!receipt.status) {
        const error = new Error(`Transaction reverted: ${hash}`)
        error.receipt = receipt
        throw error
      }
      if (txCallbacks.onReceipt) txCallbacks.onReceipt(receipt)
      if (txCallbacks.onConfirmation) txCallbacks.onConfirmation(1, receipt)
      return receipt
    } catch (error) {
      if (txCallbacks.onError) txCallbacks.onError(error)
      throw error
    }
  }

  addWallet(account) {
    const { address } = account
    const normalizedAddress = address.toLowerCase()

    this.addresses.push(address)
    this.wallets[normalizedAddress] = account
  }

  addKMSWallet(address, kmsKeyId) {
    // Store KMS wallet info without adding to Web3 accounts
    const normalizedAddress = address.toLowerCase()
    this.addresses.push(address)
    this.wallets[normalizedAddress] = { address, kmsKeyId, isKMS: true }
  }

  async getKMSKeyIdsByTag() {
    // If KMS_KEYS_TAG is set, discover keys by tag
    if (this.conf.kmsKeysTag) {
      try {
        const kmsWallet = new KMSWallet(this.conf.kmsRegion)
        const keyIds = await kmsWallet.discoverKeysByTag(this.conf.kmsKeysTag)
        return keyIds.length > 0 ? keyIds : null
      } catch (error) {
        this.log.warn('Failed to discover KMS keys by tag', {
          tag: this.conf.kmsKeysTag,
          error: error.message
        })
        return null
      }
    }
    return null
  }

  isKMSWallet(address) {
    const normalizedAddress = address.toLowerCase()
    const wallet = this.wallets[normalizedAddress]
    return wallet && wallet.isKMS === true
  }

  async init() {
    const { log } = this

    const adminWalletAddress = get(ContractsAddress, `${this.network}.AdminWallet`)
    log.debug('WalletInit: Initializing wallet:', { conf: this.ethereum, adminWalletAddress, name: this.name })

    if (!adminWalletAddress) {
      log.debug('WalletInit: missing adminwallet address skipping initialization', {
        conf: this.ethereum,
        adminWalletAddress,
        name: this.name
      })
      return false
    }

    this.txManager = getManager(this.ethereum.network_id)
    assign(this, await this.createClients())

    // Check if provider supports EIP-1559 once on wallet creation and cache the result
    // This avoids repeated RPC calls for the same network
    this._supportsEIP1559 = await this.supportsEIP1559()
    if (!this._supportsEIP1559) {
      log.debug('Provider does not support EIP-1559, clearing maxFeePerGas and maxPriorityFeePerGas', {
        network: this.network,
        networkId: this.networkId
      })
      this.maxFeePerGas = undefined
      this.maxPriorityFeePerGas = undefined
    }

    // Initialize wallet based on useKMS flag
    if (this.useKMS) {
      // If useKMS is true, only use KMS wallet initialization (no fallback)
      let kmsKeyIds = null
      let kmsKeySource = null

      // Try tag-based discovery first
      if (this.conf.kmsKeysTag) {
        try {
          kmsKeyIds = await this.getKMSKeyIdsByTag()
          if (kmsKeyIds && kmsKeyIds.length > 0) {
            kmsKeySource = 'tag'
            log.info('WalletInit: Discovered KMS keys by tag', {
              tag: this.conf.kmsKeysTag,
              keyCount: kmsKeyIds.length
            })
          }
        } catch (error) {
          log.warn('WalletInit: Failed to discover KMS keys by tag, trying direct key IDs', {
            tag: this.conf.kmsKeysTag,
            error: error.message
          })
        }
      }

      // If tag-based discovery didn't work, try direct key IDs
      if (!kmsKeyIds || kmsKeyIds.length === 0) {
        if (this.conf.kmsKeyIds) {
          // Parse comma-separated key IDs
          kmsKeyIds = this.conf.kmsKeyIds
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0)
          kmsKeySource = 'direct'
          if (kmsKeyIds.length > 0) {
            log.info('WalletInit: Using direct KMS key IDs', {
              keyCount: kmsKeyIds.length
            })
          }
        }
      }

      if (!kmsKeyIds || kmsKeyIds.length === 0) {
        throw new Error('KMS wallet requested (useKMS=true) but no KMS keys found. Configure kmsKeysTag or kmsKeyIds.')
      }

      this.numberOfAdminWalletAccounts = kmsKeyIds.length

      // Initialize KMS wallet
      this.kmsWallet = new KMSWallet(this.conf.kmsRegion)

      // Initialize with discovered/provided KMS key IDs - add timeout to prevent hanging in CI
      const addresses = await Promise.race([
        this.kmsWallet.initialize(kmsKeyIds),
        new Promise((_, reject) => setTimeout(() => reject(new Error('KMS initialization timeout')), 10000))
      ])
      addresses.forEach(address => {
        const keyId = this.kmsWallet.getKeyId(address)
        this.addKMSWallet(address, keyId)
      })
      log.info('WalletInit: Initialized by KMS keys:', {
        addresses,
        keyIds: kmsKeyIds,
        source: kmsKeySource,
        tag: kmsKeySource === 'tag' ? this.conf.kmsKeysTag : undefined,
        network: this.network
      })
    } else {
      // If useKMS is false, skip KMS and use mnemonic or private key
      this.numberOfAdminWalletAccounts = conf.privateKey ? 1 : conf.numberOfAdminWalletAccounts

      // Try mnemonic first
      if (this.mnemonic) {
        let root = HDKey.fromMasterSeed(bip39.mnemonicToSeed(this.mnemonic, this.conf.adminWalletPassword))

        for (let i = 0; i < this.numberOfAdminWalletAccounts; i++) {
          const path = "m/44'/60'/0'/0/" + i
          let addrNode = root.derive(path)
          let account = privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))
          account.privateKey = '0x' + addrNode._privateKey.toString('hex')

          this.addWallet(account)
        }

        log.info('WalletInit: Initialized by mnemonic:', { address: this.addresses })
      } else if (this.conf.privateKey) {
        // Fallback to private key if mnemonic is not configured
        let account = privateKeyToAccount(this.conf.privateKey)
        account.privateKey = this.conf.privateKey

        this.address = account.address
        this.addWallet(account)

        log.info('WalletInit: Initialized by private key:', { address: account.address })
      } else {
        log.warn('WalletInit: No wallet configuration found (useKMS=false, no mnemonic, no privateKey)')
      }
    }

    // In test mode, if adminWalletAddress is missing, skip contract initialization but return success
    if (!adminWalletAddress) {
      log.debug('WalletInit: Test mode - skipping contract initialization', {
        addresses: this.addresses,
        network: this.network
      })
      return true
    }

    try {
      log.info('WalletInit: Obtained AdminWallet address', { adminWalletAddress, network: this.network })

      // Reset per-run so re-running init() doesn't keep stacking addresses found by a previous run.
      this.filledAddresses = []

      const adminWalletContractBalance = await this.publicClient
        .getBalance({ address: adminWalletAddress })
        .then(balance => balance.toString())
      log.info(`WalletInit: AdminWallet contract balance`, { adminWalletContractBalance, adminWalletAddress })

      // Initialize without `from` first, then re-bind after selecting a valid admin wallet.
      this.proxyContract = this.getContract(AdminWalletABI, adminWalletAddress)

      const maxAdminBalance = await this.proxyContract.read.adminToppingAmount([])
      const minAdminBalance = parseInt(formatUnits(BigInt(maxAdminBalance), 9)) / 2

      if (formatUnits(BigInt(adminWalletContractBalance), 9) < minAdminBalance * this.addresses.length) {
        log.error('AdminWallet contract low funds')
        await sendSlackAlert({
          msg: `AdminWallet contract low funds ${this.name}`,
          adminWalletAddress,
          adminWalletContractBalance
        })
      }

      this.txManager.getTransactionCount = address => this.publicClient.getTransactionCount({ address })
      await this.txManager.createListIfNotExists(this.addresses)

      log.info('WalletInit: Initialized wallet queue manager')

      log.info('Initializing adminwallet addresses', { addresses: this.addresses })

      for (const addr of this.addresses) {
        const balance = await this.publicClient.getBalance({ address: addr }).then(balance => balance.toString())
        const isAdminWallet = await this.isVerifiedAdmin(addr)

        if (isAdminWallet && parseFloat(formatUnits(BigInt(balance), 9)) > minAdminBalance) {
          log.info(`WalletInit: set default wallet to ${addr} with balance ${balance}`)
          this.address = addr
          break
        }
      }

      // No configured wallet met the funding threshold above. Fall back to the first
      // configured address instead of leaving `this.address` undefined, otherwise the
      // getBalance/getTransactionCount calls below crash the process on an invalid
      // (undefined) address even though the low-funds condition is already alerted on
      // via Slack a few lines down. If there is no configured address at all, that's a
      // genuine misconfiguration (no mnemonic/privateKey/KMS wallets set up) - fail loudly
      // through the existing catch below instead of silently continuing with no address.
      if (!this.address) {
        if (this.addresses.length === 0) {
          throw new Error('WalletInit: no admin wallet addresses configured (missing mnemonic/privateKey/KMS wallets)')
        }

        this.address = this.addresses[0]
      }

      this.proxyContract = this.getContract(AdminWalletABI, adminWalletAddress)

      if (this.conf.topAdminsOnStartup) {
        log.info('WalletInit: calling topAdmins...')
        await this.topAdmins(this.conf.numberOfAdminWalletAccounts).catch(e => {
          log.warn('WalletInit: topAdmins failed', { e, errMessage: e.message })
        })
      }

      await Promise.all(
        this.addresses.map(async addr => {
          const balance = await this.publicClient.getBalance({ address: addr }).then(balance => balance.toString())
          const isAdminWallet = await this.isVerifiedAdmin(addr)

          log.info(`WalletInit: try address ${addr}:`, { balance, isAdminWallet, minAdminBalance })

          if (isAdminWallet && parseFloat(formatUnits(BigInt(balance), 9)) > minAdminBalance) {
            log.info(`WalletInit: admin wallet ${addr} balance ${balance}`)
            this.filledAddresses.push(addr)
          }
        })
      )

      log.info('WalletInit: Initialized adminwallet addresses', { filled: this.filledAddresses })

      if (this.filledAddresses.length === 0) {
        log.error('WalletInit: no admin wallet with funds')

        // dont send alert for base network on dev env
        if (this.network === 'production' || this.name !== 'BaseAdminWallet') {
          await sendSlackAlert({
            msg: `critical: no admin wallet with funds ${this.name}`
          })
        }
      }

      this.identityContract = this.getContract(
        IdentityABI.abi,
        get(ContractsAddress, `${this.network}.Identity`, ADDRESS_ZERO)
      )

      const oldIdentity = get(ContractsAddress, `${this.network}.IdentityOld`)
      if (oldIdentity) {
        this.oldIdentityContract = this.getContract(IdentityABI.abi, oldIdentity)
      }

      this.tokenContract = this.getContract(
        GoodDollarABI.abi,
        get(ContractsAddress, `${this.network}.GoodDollar`, ADDRESS_ZERO)
      )

      this.UBIContract = this.getContract(UBIABI.abi, get(ContractsAddress, `${this.network}.UBIScheme`, ADDRESS_ZERO))

      this.faucetContract = this.getContract(
        FaucetABI.abi,
        get(
          ContractsAddress,
          `${this.network}.FuseFaucet`,
          get(ContractsAddress, `${this.network}.Faucet`),
          ADDRESS_ZERO
        )
      )

      const buygdAddress = get(
        ContractsAddress,
        `${this.network}.BUYGDFactoryV3`,
        get(ContractsAddress, `${this.network}.BuyGDFactoryV2`, get(ContractsAddress, `${this.network}.BuyGDFactory`))
      )
      if (buygdAddress) {
        this.buygdFactoryContract = this.getContract(BuyGDFactoryABI.abi, buygdAddress)
      }

      let nativebalance = await this.publicClient
        .getBalance({ address: this.address })
        .then(balance => balance.toString())
      this.nonce = parseInt(await this.publicClient.getTransactionCount({ address: this.address }))

      log.debug('WalletInit: AdminWallet Ready:', {
        activeWallets: this.filledAddresses.length,
        account: this.address,
        nativebalance,
        networkId: this.networkId,
        network: this.network,
        nonce: this.nonce,
        ContractsAddress: ContractsAddress[this.network]
      })
    } catch (e) {
      log.error('WalletInit: Error initializing wallet', e.message, e)

      await sendSlackAlert({
        msg: `CRITICAL: AdminWallet init failed - ${e.message} ${this.name}`
      })

      return false
    }

    return true
  }

  /**
   * top admin wallet accounts
   * @param {object} event callbacks
   * @returns {Promise<String>}
   */
  async topAdmins(numAdmins: number): Promise<any> {
    const { log } = this

    try {
      log.debug('topAdmins:', { numAdmins, addresses: this.addresses })
      for (let i = 0; i < numAdmins; i += 50) {
        log.debug('topAdmins sending tx', { adminIdx: i })
        await this.sendTransaction(
          this.contractTransaction(this.proxyContract, 'topAdmins', [i, i + 50]),
          {},
          { from: this.addresses[0] },
          true,
          log
        )
        log.debug('topAdmins success', { adminIdx: i })
      }
    } catch (e) {
      log.error('topAdmins failed', e)
    }
  }

  /**
   * whitelist an user in the `Identity` contract
   * @param {string} address
   * @param {string} did
   * @returns {Promise<TransactionReceipt>}
   */
  async whitelistUser(
    address: string,
    did: string,
    chainId: number = null,
    lastAuthenticated: number = 0,
    customLogger = null
  ): Promise<TransactionReceipt | boolean> {
    const log = customLogger || this.log

    let txHash

    try {
      const isWhitelisted = await this.isVerified(address)
      // if lastAuthenticated is 0, then we force reauthentication, otherwise assume this is just syncing whitelisting between chains
      const isVerified = lastAuthenticated > 0 && isWhitelisted

      if (isVerified) {
        return { status: true }
      }

      const [identityRecord, lastAuth] = await Promise.all([
        this.identityContract.read.identities([address]),
        this.identityContract.read.lastAuthenticated([address]).then(parseInt)
      ])

      if (Number(identityRecord[4]) === 1) {
        // user was already whitelisted in the past, just needs re-authentication
        return this.authenticateUser(address, log)
      }

      const onTransactionHash = hash => {
        log.debug('Whitelisting user got txhash:', { hash, address, did, wallet: this.name })
        txHash = hash
      }

      // we add a check for lastAuth, since on fuse the identityRecord can be empty for OLD whitelisted accounts and we don't want
      // to mark them as whitelisted on a chain other than fuse
      const txExtraArgs =
        conf.enableWhitelistAtChain && chainId !== null && lastAuth === 0 ? [chainId, lastAuthenticated] : []

      const txPromise = this.sendTransaction(
        this.contractTransaction(this.proxyContract, 'whitelist', [address, did, ...txExtraArgs]),
        {
          onTransactionHash
        },
        undefined,
        true,
        log
      )

      const tx = await txPromise

      log.info('Whitelisting user success:', { txHash, address, did, chainId, lastAuthenticated, wallet: this.name })
      return tx
    } catch (exception) {
      const { message } = exception

      log.warn('Whitelisting user failed:', message, exception, {
        txHash,
        address,
        did,
        chainId,
        lastAuthenticated,
        wallet: this.name
      })
      throw exception
    }
  }

  async authenticateUser(address: string, customLogger = null): Promise<TransactionReceipt> {
    const log = customLogger || this.log

    try {
      let encodedCall = encodeFunctionData({
        abi: [
          {
            name: 'authenticate',
            type: 'function',
            inputs: [
              {
                type: 'address',
                name: 'account'
              }
            ]
          }
        ],
        functionName: 'authenticate',
        args: [address]
      })

      const transaction = await this.contractTransaction(this.proxyContract, 'genericCall', [
        this.identityContract.address,
        encodedCall,
        0
      ])
      const tx = await this.sendTransaction(transaction, {}, undefined, true, log)

      log.info('authenticating user success:', { address, tx, wallet: this.name })
      return tx
    } catch (exception) {
      const { message } = exception

      log.warn('authenticating user failed:', message, exception, { address })
      throw exception
    }
  }

  async getAuthenticationPeriod(): Promise<number> {
    const { log } = this

    try {
      const result = await this.identityContract.read.authenticationPeriod([]).then(parseInt)

      return result
    } catch (exception) {
      const { message } = exception

      log.warn('Error getAuthenticationPeriod', message, exception)
      throw exception
    }
  }

  async getWhitelistedOnChainId(account): Promise<number> {
    const { log } = this

    try {
      const result = await this.identityContract.read.getWhitelistedOnChainId([account]).then(parseInt)

      return result
    } catch (exception) {
      const { message } = exception

      log.warn('Error getWhitelistedOnChainId', message, exception)
      throw exception
    }
  }

  async getLastAuthenticated(account): Promise<number> {
    const { log } = this

    try {
      const [newResult, oldResult] = await Promise.all([
        this.identityContract.read
          .lastAuthenticated([account])
          .then(parseInt)
          .catch(() => 0),
        this.oldIdentityContract
          ? this.oldIdentityContract.read
              .lastAuthenticated([account])
              .then(parseInt)
              .catch(() => 0)
          : Promise.resolve(0)
      ])

      return newResult || oldResult
    } catch (exception) {
      const { message } = exception

      log.warn('Error getLastAuthenticated', message, exception)
      throw exception
    }
  }

  /**
   * blacklist an user in the `Identity` contract
   * @param {string} address
   * @returns {Promise<TransactionReceipt>}
   */
  async blacklistUser(address: string): Promise<TransactionReceipt> {
    const { log } = this

    const tx: TransactionReceipt = await this.sendTransaction(
      this.contractTransaction(this.proxyContract, 'blacklist', [address])
    ).catch(e => {
      log.error('Error blackListUser', e.message, e, { address })
      throw e
    })

    return tx
  }

  /**
   * remove a user in the `Identity` contract
   * @param {string} address
   * @returns {Promise<TransactionReceipt>}
   */
  async removeWhitelisted(address: string): Promise<TransactionReceipt> {
    const { log } = this

    const tx: TransactionReceipt = await this.sendTransaction(
      this.contractTransaction(this.proxyContract, 'removeWhitelist', [address])
    ).catch(e => {
      log.error('Error removeWhitelisted', e.message, e, { address })
      throw e
    })

    return tx
  }

  /**
   * verify if an user is verified in the `Identity` contract
   * @param {string} address
   * @returns {Promise<boolean>}
   */
  async isVerified(address: string): Promise<boolean> {
    const { log } = this

    const tx: boolean = await this.identityContract.read.isWhitelisted([address]).catch(e => {
      log.error('Error isVerified', e.message, e)
      throw e
    })

    return tx
  }

  /**
   * verify if an account is connected or itself is a whitelisted identity in the `Identity` contract
   * @param {string} address
   * @returns {Promise<boolean>}
   */
  async isConnected(address: string): Promise<boolean> {
    const { log } = this

    const tx: string = await this.identityContract.read.getWhitelistedRoot([address]).catch(e => {
      log.error('Error isConnected', e.message, e)
      throw e
    })

    return tx !== ADDRESS_ZERO
  }
  async getDID(address: string): Promise<string> {
    const { log } = this

    const tx: boolean = await this.identityContract.read.addrToDID([address]).catch(e => {
      log.error('Error getDID', e.message, e)
      throw e
    })

    return tx
  }
  /**
   *
   * @param {string} address
   * @returns {Promise<boolean>}
   */
  async isVerifiedAdmin(address: string): Promise<boolean> {
    const { log } = this

    const tx: boolean = await this.proxyContract.read.isAdmin([address]).catch(e => {
      log.error('Error isAdmin', e.message, e)
      throw e
    })

    return tx
  }

  /**
   * top wallet if needed
   * @param {string} address
   * @returns {PromiEvent<TransactionReceipt>}
   */
  async topWallet(address: string, customLogger = null): PromiEvent<TransactionReceipt> {
    const logger = customLogger || this.log

    // try to call regular faucet if possible, if it fails (eg user is not eligible) then we will try to topwallet from admin wallet
    const faucetRes = await this.topWalletFaucet(address, logger).catch(() => false)

    if (faucetRes) {
      return faucetRes
    }

    // if we reached here, we use the admin wallet to topwallet, but first we simulate the call to check if it will revert (eg if user is not whitelisted) so we don't waste admin funds on tx that will fail
    let txHash = ''

    // simulate tx to detect revert
    const canTopOrError = await retryAsync(
      () =>
        this.publicClient
          .simulateContract({
            address: this.proxyContract.address,
            abi: this.proxyContract.abi,
            functionName: 'topWallet',
            args: [address],
            account: this.address
          })
          .then(() => true)
          .catch(e => {
            if (e.message.search(/VM execution|reverted/i) >= 0) {
              return false
            } else {
              logger.debug('retrying canTopOrError', e.message, { chainId: this.networkId, data: e.data })
              throw e
            }
          }),
      3,
      500
    ).catch(e => {
      logger.warn('canTopOrError failed after retries', e.message, e, { chainId: this.networkId })
      throw e
    })

    if (canTopOrError === false) {
      let userBalance = BigInt(
        await this.publicClient.getBalance({ address: address }).then(balance => balance.toString())
      )
      logger.debug('Topwallet will revert, skipping', { address, canTopOrError, wallet: this.name, userBalance })
      return false
    }

    try {
      const onTransactionHash = hash => {
        logger.debug('Topwallet got txhash:', { hash, address, wallet: this.name })
        txHash = hash
      }

      const res = await this.sendTransaction(
        this.contractTransaction(this.proxyContract, 'topWallet', [address]),
        { onTransactionHash },
        undefined,
        true,
        logger
      )

      logger.debug('Topwallet result:', { txHash, address, res, wallet: this.name })
      return res
    } catch (e) {
      logger.error('Error topWallet', e.message, e, { txHash, address, wallet: this.name })
      throw e
    }
  }

  async banInFaucet(toBan, customLogger = null) {
    const logger = customLogger || this.log
    const chunks = chunk(toBan, 25)
    logger.debug('banInFaucet:', {
      toBan,
      chunks: chunks.length
    })
    for (const idx in chunks) {
      const addresses = chunks[idx]
      logger.debug('banInFaucet chunk:', {
        addresses,
        idx
      })
      try {
        const datas = addresses.map(address => {
          let encodedCall = encodeFunctionData({
            abi: [
              {
                name: 'banAddress',
                type: 'function',
                inputs: [
                  {
                    type: 'address',
                    name: 'account'
                  }
                ]
              }
            ],
            functionName: 'banAddress',
            args: [address]
          })
          return encodedCall
        })
        const contracts = addresses.map(() => this.faucetContract.address)
        const values = addresses.map(() => 0)
        const transaction = this.contractTransaction(this.proxyContract, 'genericCallBatch', [contracts, datas, values])
        const onTransactionHash = hash =>
          void logger.debug('banInFaucet got txhash:', { hash, addresses, wallet: this.name })
        const res = await this.sendTransaction(transaction, { onTransactionHash }, undefined, true, logger)

        logger.debug('banInFaucet result:', { addresses, res, wallet: this.name })
        return res
      } catch (e) {
        logger.error('Error banInFaucet', e.message, e, { addresses, wallet: this.name })
        throw e
      }
    }
  }

  async topWalletFaucet(address, customLogger = null) {
    const logger = customLogger || this.log

    // Check if faucet contract is properly initialized with a valid address
    const faucetAddress = this.faucetContract?.address
    if (!faucetAddress || faucetAddress === ADDRESS_ZERO) {
      logger.debug('topWalletFaucet: no valid faucet contract address', { wallet: this.name })
      return false // fall back to admin wallet topping
    }

    try {
      const canTop = await this.faucetContract.read.canTop([address])

      logger.debug('topWalletFaucet canTop result:', { address, canTop, wallet: this.name })

      if (canTop === false) {
        return false //we try to top from admin wallet
      }

      let userBalance = BigInt(
        await this.publicClient.getBalance({ address: address }).then(balance => balance.toString())
      )
      const gasPrice = await this.publicClient.getGasPrice()
      let faucetTxCost = BigInt(this.faucetTxCost) * BigInt(gasPrice)

      logger.debug('topWalletFaucet:', {
        address,
        userBalance: userBalance.toString(),
        faucetTxCost: faucetTxCost.toString(),
        wallet: this.name
      })

      // user can't call faucet directly
      if (forceUserToUseFaucet && userBalance >= faucetTxCost) {
        logger.debug('User has enough gas to call faucet', { address, wallet: this.name })
        return true //return true so we don't call AdminWallet to topwallet
      }

      let encodedCall = encodeFunctionData({
        abi: [
          {
            name: 'topWallet',
            type: 'function',
            inputs: [
              {
                type: 'address',
                name: 'account'
              }
            ]
          }
        ],
        functionName: 'topWallet',
        args: [address]
      })

      const transaction = this.contractTransaction(this.proxyContract, 'genericCall', [
        this.faucetContract.address,
        encodedCall,
        0
      ])
      const onTransactionHash = hash =>
        void logger.debug('topWalletFaucet got txhash:', { hash, address, wallet: this.name })
      const res = await this.sendTransaction(transaction, { onTransactionHash }, undefined, true, logger)

      logger.debug('topWalletFaucet result:', { address, res, wallet: this.name })
      return res
    } catch (e) {
      logger.error('Error topWalletFaucet', e.message, e, { address, wallet: this.name })
      throw e
    }
  }

  async fishMulti(toFish: Array<string>, customLogger = null): Promise<TransactionReceipt> {
    const logger = customLogger || this.log

    try {
      let encodedCall = encodeFunctionData({
        abi: [
          {
            name: 'fishMulti',
            type: 'function',
            inputs: [
              {
                type: 'address[]',
                name: '_accounts'
              }
            ]
          }
        ],
        functionName: 'fishMulti',
        args: [toFish]
      })

      logger.info('fishMulti sending tx', { encodedCall, toFish, ubischeme: this.UBIContract.address })

      const transaction = await this.contractTransaction(this.proxyContract, 'genericCall', [
        this.UBIContract.address,
        encodedCall,
        0
      ])
      const tx = await this.sendTransaction(transaction, {}, { gas: 2000000 }, false, logger)

      logger.info('fishMulti success', { toFish, tx: tx.transactionHash })
      return tx
    } catch (exception) {
      const { message } = exception

      logger.error('fishMulti failed', message, exception, { toFish })
      throw exception
    }
  }

  async swaphelper(address, customLogger = null) {
    const logger = customLogger || this.log
    const predictedAddress = await this.buygdFactoryContract.read.predict([address])
    const isHelperDeployed = await this.publicClient
      .getBytecode({ address: predictedAddress })
      .then(code => Boolean(code && code !== '0x'))

    try {
      let swapResult
      if (isHelperDeployed) {
        const buygdContract = this.getContract(BuyGDABI.abi, predictedAddress)
        //simulate tx
        const estimatedGas = await buygdContract.estimateGas
          .swap([0, this.proxyContract.address], { account: this.address })
          .then(_ => parseInt(_) + 200000)

        let encodedCall = encodeFunctionData({
          abi: [
            {
              name: 'swap',
              type: 'function',
              inputs: [
                {
                  type: 'uint256',
                  name: 'minAmount'
                },
                {
                  type: 'address',
                  name: 'gasRefund'
                }
              ]
            }
          ],
          functionName: 'swap',
          args: [0, this.proxyContract.address]
        })

        const transaction = this.contractTransaction(this.proxyContract, 'genericCall', [
          predictedAddress,
          encodedCall,
          0
        ])
        const onTransactionHash = hash =>
          void logger.debug('swaphelper swap got txhash:', { estimatedGas, hash, address, wallet: this.name })
        swapResult = await this.sendTransaction(transaction, { onTransactionHash }, { gas: estimatedGas }, true, logger)
      } else {
        //simulate tx
        const estimatedGas = await this.buygdFactoryContract.estimateGas
          .createAndSwap([address, 0], { account: this.address })
          .then(_ => parseInt(_) + 200000)
        let encodedCall = encodeFunctionData({
          abi: [
            {
              name: 'createAndSwap',
              type: 'function',
              inputs: [
                {
                  type: 'address',
                  name: 'account'
                },
                {
                  type: 'uint256',
                  name: 'minAmount'
                }
              ]
            }
          ],
          functionName: 'createAndSwap',
          args: [address, 0]
        })

        const transaction = this.contractTransaction(this.proxyContract, 'genericCall', [
          this.buygdFactoryContract.address,
          encodedCall,
          0
        ])
        const onTransactionHash = hash =>
          void logger.debug('swaphelper createAndSwap got txhash:', { estimatedGas, hash, address, wallet: this.name })
        swapResult = await this.sendTransaction(transaction, { onTransactionHash }, { gas: estimatedGas }, true, logger)
      }

      logger.debug('swaphelper tx result:', { address, swapResult, wallet: this.name })

      return swapResult
    } catch (e) {
      logger.error('Error swaphelper', e.message, e, { address, predictedAddress, isHelperDeployed, wallet: this.name })
      throw e
    }
  }

  /**
   * transfer G$s locked in adminWallet contract to recipient
   * @param {*} to recipient
   * @param {*} value amount to transfer
   * @param {*} logger
   * @returns
   */
  async transferWalletGoodDollars(to, value, customLogger = null): Promise<TransactionReceipt> {
    const logger = customLogger || this.log

    try {
      let encodedCall = encodeFunctionData({
        abi: [
          {
            name: 'transfer',
            type: 'function',
            inputs: [
              {
                type: 'address',
                name: 'to'
              },
              {
                type: 'uint256',
                name: 'value'
              }
            ]
          }
        ],
        functionName: 'transfer',
        args: [to, value]
      })
      logger.info('transferWalletGoodDollars sending tx', { encodedCall, to, value })

      const transaction = await this.contractTransaction(this.proxyContract, 'genericCall', [
        this.tokenContract.address,
        encodedCall,
        0
      ])
      const tx = await this.sendTransaction(transaction, {}, undefined, false, logger)

      logger.info('transferWalletGoodDollars success', { to, value, tx: tx.transactionHash })
      return tx
    } catch (exception) {
      const { message } = exception

      logger.error('transferWalletGoodDollars failed', message, exception, { to, value })
      throw exception
    }
  }

  async getAddressBalance(address: string): Promise<string> {
    return this.publicClient.getBalance({ address: address }).then(balance => balance.toString())
  }

  /**
   * get balance for admin wallet
   * @returns {Promise<number>}
   */
  async getBalance(): Promise<number> {
    const { log } = this

    return this.getAddressBalance(this.address)
      .then(b => parseFloat(formatEther(BigInt(b))))
      .catch(e => {
        log.error('Error getBalance', e.message, e)
        throw e
      })
  }

  async registerRedtent(account: string, countryCode: string, customLogger = null): Promise<TransactionReceipt> {
    const logger = customLogger || this.log

    if (this.networkId != 42220) {
      logger.info(`skipping registerRedtent for non Celo: ${this.networkId}`)
      return
    }
    const poolAddress = conf.redtentPools[countryCode]

    try {
      let encodedCall = encodeFunctionData({
        abi: [
          {
            name: 'addMember',
            type: 'function',
            inputs: [
              {
                name: 'member',
                type: 'address'
              },
              {
                name: 'extraData',
                type: 'bytes'
              }
            ]
          }
        ],
        functionName: 'addMember',
        args: [account, '0x']
      })

      const transaction = await this.contractTransaction(this.proxyContract, 'genericCall', [
        poolAddress,
        encodedCall,
        0
      ])
      const tx = await this.sendTransaction(transaction, {}, undefined, false, logger)

      logger.info('registerRedtent success', { account, countryCode, tx: tx.transactionHash, poolAddress })
      return tx
    } catch (exception) {
      const { message } = exception

      logger.error('registerRedtent failed', message, exception, { account, poolAddress, countryCode })
      throw exception
    }
  }

  async getFeeEstimates() {
    const result = await this.publicClient.getFeeHistory({ blockCount: 5, blockTag: 'latest', rewardPercentiles: [10] })
    const baseFees = result.baseFeePerGas.map(Number)
    const rewards = (result.reward || []).map(reward => Number(reward[0]))

    const latestBaseFee = baseFees[baseFees.length - 1]
    const minPriorityFee = rewards.length ? Math.min(...rewards) : 0

    return {
      baseFee: Math.floor(latestBaseFee * 1.1), // in wei
      priorityFee: minPriorityFee // in wei
    }
  }

  /**
   * Normalize gas pricing parameters - handles legacy gasPrice vs EIP-1559 fees
   * Deduplicates gas pricing logic used in sendTransaction and sendNative
   * @private
   * @param {Object} params - Gas pricing parameters
   * @param {string|undefined} params.gasPrice - Legacy gas price
   * @param {string|undefined} params.maxFeePerGas - EIP-1559 max fee per gas
   * @param {string|undefined} params.maxPriorityFeePerGas - EIP-1559 priority fee
   * @param {Object} logger - Logger instance
   * @returns {Promise<Object>} Normalized gas pricing with gasPrice, maxFeePerGas, maxPriorityFeePerGas
   */
  async normalizeGasPricing({ gasPrice, maxFeePerGas, maxPriorityFeePerGas }, logger) {
    // Helper to convert value to number (handles string, number, null, undefined)
    const toNumber = val => {
      if (val === null || val === undefined) return 0
      return typeof val === 'string' ? parseInt(val) || 0 : Number(val) || 0
    }

    // Check if network supports EIP-1559
    const supportsEIP1559 = await this.supportsEIP1559()

    if (!supportsEIP1559) {
      // Network doesn't support EIP-1559, use legacy gasPrice only
      gasPrice = gasPrice || this.gasPrice
      logger.debug('Network does not support EIP-1559, using legacy gasPrice', {
        network: this.network,
        networkId: this.networkId
      })
      return { gasPrice, maxFeePerGas: undefined, maxPriorityFeePerGas: undefined }
    } else {
      // Network supports EIP-1559, process EIP-1559 fees
      // Use instance defaults if not provided
      maxFeePerGas = maxFeePerGas !== undefined ? maxFeePerGas : this.maxFeePerGas
      maxPriorityFeePerGas = maxPriorityFeePerGas !== undefined ? maxPriorityFeePerGas : this.maxPriorityFeePerGas

      logger.debug('normalizeGasPricing initial values:', {
        chainId: this.networkId,
        maxFeePerGas,
        maxPriorityFeePerGas
      })

      // Convert to numbers for comparison
      let maxFeeNum = toNumber(maxFeePerGas)
      let maxPriorityNum = toNumber(maxPriorityFeePerGas)

      // Fetch fee estimates if EIP-1559 fees are not provided or invalid
      if (!maxFeeNum || !maxPriorityNum) {
        const { baseFee, priorityFee } = await this.getFeeEstimates()
        maxFeePerGas = maxFeeNum || baseFee
        maxPriorityFeePerGas = Math.max(maxPriorityNum || priorityFee, 1e8) // ensure a minimum priority fee of 0.1 gwei to avoid getting stuck
        maxFeeNum = toNumber(maxFeePerGas)
        maxPriorityNum = toNumber(maxPriorityFeePerGas)
      }

      // Ensure maxFeePerGas >= maxPriorityFeePerGas (EIP-1559 requirement)
      if (maxPriorityNum > 0 && (maxFeeNum === 0 || maxFeeNum < maxPriorityNum)) {
        logger.warn('maxFeePerGas < maxPriorityFeePerGas or is 0, adjusting maxFeePerGas', {
          originalMaxFeePerGas: maxFeePerGas,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          adjustedMaxFeePerGas: maxPriorityFeePerGas
        })
        maxFeePerGas = maxPriorityFeePerGas
      }
      logger.debug('normalizeGasPricing final values:', {
        chainId: this.networkId,
        maxFeePerGas,
        maxPriorityFeePerGas
      })

      return { gasPrice: undefined, maxFeePerGas, maxPriorityFeePerGas }
    }
  }

  /**
   * Check if the RPC supports EIP-1559 using multiple methods:
   * Check chain ID against known EIP-1559 supporting networks
   * Result is cached after first call to avoid repeated RPC calls
   * @returns Promise resolving to boolean indicating EIP-1559 support
   */
  async supportsEIP1559(): Promise<boolean> {
    // Return cached result if available (set during wallet initialization)
    if (this._supportsEIP1559 !== null) {
      return this._supportsEIP1559
    }

    const { log } = this
    try {
      const client = this.publicClient
      if (!client) {
        log.warn('No viem client available for EIP-1559 check')
        this._supportsEIP1559 = false
        return false
      }

      const chainId = await client.getChainId()
      const knownEIP1559Chains = new Set([
        1, // Ethereum Mainnet
        11155111, // Ethereum Sepolia
        8453, // Base
        137, // Polygon
        42161, // Arbitrum One
        10, // Optimism
        5, // Goerli
        80001, // Mumbai (Polygon testnet)
        122, // Fuse
        42220, // Celo
        4447, // Local Testnet
        50,
        122
      ])

      if (knownEIP1559Chains.has(chainId)) {
        this._supportsEIP1559 = true
        return true
      }

      this._supportsEIP1559 = false
      return false
    } catch (error) {
      log.warn('Failed to check EIP-1559 support, assuming legacy network', {
        error: error.message,
        networkId: this.networkId
      })
      // If we can't check, assume it doesn't support EIP-1559 (safer fallback)
      this._supportsEIP1559 = false
      return false
    }
  }

  /**
   * Sign transaction with KMS and return the signed transaction string
   * @private
   */
  async _signTransactionWithKMS(
    tx: any,
    address: string,
    txParams: {
      gas: number,
      maxFeePerGas?: string,
      maxPriorityFeePerGas?: string,
      gasPrice?: string,
      nonce: number,
      chainId: number,
      value?: string | number
    }
  ): Promise<string> {
    const { gas, maxFeePerGas, maxPriorityFeePerGas, gasPrice, nonce, chainId } = txParams
    const logger = this.log

    const { data: txData, to } = tx
    const value = txParams.value ?? tx.value ?? '0'

    // Build transaction parameters for KMS
    const kmsTxParams = {
      to,
      data: txData,
      nonce,
      chainId,
      gasLimit: gas.toString()
    }

    // Add value if non-zero (for payable functions)
    // kms-ethereum-signing expects value as a decimal string
    if (value && value !== '0' && value !== 0) {
      kmsTxParams.value = value.toString()
    }

    if (maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined) {
      kmsTxParams.maxFeePerGas = maxFeePerGas.toString()
      kmsTxParams.maxPriorityFeePerGas = maxPriorityFeePerGas.toString()
    } else {
      kmsTxParams.gasPrice = (gasPrice ?? (await this.publicClient.getGasPrice())).toString()
    }

    // Sign transaction with KMS
    logger.debug('Signing transaction with KMS', { address, chainId, supportsEIP1559: await this.supportsEIP1559() })
    const signedTx = await this.kmsWallet.signTransaction(address, kmsTxParams)

    return signedTx
  }

  /**
   * Helper function to handle a tx Send call
   * @param tx
   * @param {object} promiEvents
   * @param {function} promiEvents.onTransactionHash
   * @param {function} promiEvents.onReceipt
   * @param {function} promiEvents.onConfirmation
   * @param {function} promiEvents.onError
   * @param {object} gasValues
   * @param {number} gasValues.gas
   * @param {number} gasValues.maxFeePerGas
   * @param {number} gasValues.maxPriorityFeePerGas
   * @param {string} [gasValues.from] - If set, lock and send from this address only; otherwise use this.filledAddresses
   * @returns {Promise<Promise|Q.Promise<any>|Promise<*>|Promise<*>|Promise<*>|*>}
   */
  async sendTransaction(
    tx: any,
    txCallbacks: PromiEvents = {},
    { gas, maxPriorityFeePerGas, maxFeePerGas, gasPrice, from }: GasValues = {
      gas: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      from: undefined
    },
    retry = true,
    customLogger = null
  ) {
    let currentAddress, txHash, currentNonce
    const txuuid = Crypto.randomBytes(5).toString('base64')
    const logger = customLogger || this.log

    try {
      gas =
        gas ||
        (await this.publicClient
          .estimateGas({
            ...tx,
            value: tx.value === undefined ? undefined : BigInt(tx.value),
            account: from || this.address
          })
          .then(gas => parseInt(gas) + 200000) //buffer for proxy contract, reimburseGas?
          .catch(e => {
            logger.warn('Failed to estimate gas for tx', e.message, e, { wallet: this.name, network: this.networkId })
            if (e.message.toLowerCase().includes('reverted')) throw e
            return defaultGas
          }))

      // adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) {
        gas = defaultGas
      }

      // Normalize gas pricing (deduplicated logic)
      const normalizedGas = await this.normalizeGasPricing({ gasPrice, maxFeePerGas, maxPriorityFeePerGas }, logger)
      gasPrice = normalizedGas.gasPrice
      maxFeePerGas = normalizedGas.maxFeePerGas
      maxPriorityFeePerGas = normalizedGas.maxPriorityFeePerGas

      logger.trace('getting tx lock:', { txuuid, fromOption: from })

      const addressesToLock = from != null ? [from] : this.filledAddresses
      const { nonce, release, address } = await this.txManager.lock(addressesToLock)

      logger.trace('got tx lock:', { txuuid, address })

      let balance = NaN

      if (this.conf.env === 'development') {
        balance = await this.publicClient.getBalance({ address: address }).then(balance => balance.toString())
      }

      currentAddress = address
      currentNonce = nonce
      logger.debug(`sending tx from:`, {
        address,
        nonce,
        txuuid,
        balance,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        wallet: this.name,
        isKMS: this.isKMSWallet(address)
      })

      const txPromise = this._sendViemTransaction(
        tx,
        address,
        { gas, maxFeePerGas, maxPriorityFeePerGas, gasPrice, nonce },
        txCallbacks,
        {
          release,
          onTxHash: hash => {
            txHash = hash || txHash
          }
        }
      )

      const response = await withTimeout(txPromise, FUSE_TX_TIMEOUT, `${this.name} tx timeout`)

      return response
    } catch (e) {
      // error before executing a tx
      if (!currentAddress) {
        throw e
      }
      //reset nonce on every error, on celo we dont get nonce errors
      let netNonce = parseInt(await this.publicClient.getTransactionCount({ address: currentAddress }))

      //check if tx did go through after timeout or not
      if (txHash && e.message.toLowerCase().includes('timeout')) {
        // keeping address locked for another 30 seconds
        retryAsync(
          async attempt => {
            const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash }).catch(error => {
              if (error.name === 'TransactionReceiptNotFoundError') return null
              throw error
            })
            logger.debug('retrying for timedout tx', {
              currentAddress,
              currentNonce,
              netNonce,
              attempt,
              txuuid,
              txHash,
              receipt,
              wallet: this.name,
              network: this.networkId
            })
            if (receipt) {
              await this.txManager.unlock(currentAddress, Math.max(netNonce, currentNonce + 1))
              logger.info('receipt found for timedout tx attempts', {
                currentAddress,
                currentNonce,
                attempt,
                txuuid,
                txHash,
                receipt,
                wallet: this.name,
                network: this.networkId
              })
            } else if (attempt === 4) {
              //increase nonce assuming tx went through
              await this.txManager.unlock(currentAddress, currentNonce + 1)
              logger.info('stopped retrying for timedout tx attempts', {
                currentAddress,
                currentNonce,
                netNonce,
                attempt,
                txuuid,
                txHash,
                receipt,
                wallet: this.name,
                network: this.networkId
              })
            } else throw new Error('receipt not found') //trigger retry
          },
          3,
          10000
        ).catch(e => {
          this.txManager.unlock(currentAddress, netNonce)
          logger.error('retryAsync for timeout tx failed', e.message, e, { txHash })
        })
        // return assuming tx will mine
        return
      } else if (
        retry &&
        (e.message.toLowerCase().includes('nonce') ||
          e.message.includes('FeeTooLowToCompete') ||
          e.message.includes('underpriced'))
      ) {
        logger.warn('sendTransaction assuming duplicate nonce:', {
          error: e.message,
          maxFeePerGas,
          maxPriorityFeePerGas,
          currentAddress,
          currentNonce,
          netNonce,
          txuuid,
          txHash,
          wallet: this.name,
          network: this.networkId
        })
        // increase nonce, since we assume therre's a tx pending with same nonce
        await this.txManager.unlock(currentAddress, Math.max(netNonce, currentNonce + 1))

        return this.sendTransaction(
          tx,
          txCallbacks,
          { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, from },
          true,
          logger
        )
      } else if (retry && e.message.toLowerCase().includes('revert') === false) {
        logger.warn('sendTransaction retrying non reverted error:', {
          error: e.message,
          currentAddress,
          currentNonce,
          netNonce,
          txuuid,
          txHash,
          wallet: this.name,
          network: this.networkId
        })

        await this.txManager.unlock(currentAddress, netNonce)
        return this.sendTransaction(
          tx,
          txCallbacks,
          { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, from },
          false,
          logger
        )
      }

      await this.txManager.unlock(currentAddress, netNonce)
      logger.error('sendTransaction error:', e.message, e, {
        from: currentAddress,
        currentNonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        netNonce,
        txuuid,
        txHash,
        retry,
        wallet: this.name,
        network: this.networkId
      })
      throw e
    }
  }

  /**
   * Helper function to handle a tx Send call
   * @param tx
   * @param {object} promiEvents
   * @param {function} promiEvents.onTransactionHash
   * @param {function} promiEvents.onReceipt
   * @param {function} promiEvents.onConfirmation
   * @param {function} promiEvents.onError
   * @param {object} gasValues
   * @param {number} gasValues.gas
   * @param {number} gasValues.maxFeePerGas
   * @param {number} gasValues.maxPriorityFeePerGas
   * @returns {Promise<Promise|Q.Promise<any>|Promise<*>|Promise<*>|Promise<*>|*>}
   */
  async sendNative(
    params: { from: string, to: string, value: string },
    txCallbacks: PromiEvents = {},
    gasValues: GasValues = {}
  ) {
    const { from, to, value, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas } = params
    return this.sendTransaction({ to, value }, txCallbacks, {
      gas: gas || defaultGas,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      ...gasValues,
      from
    })
  }
}

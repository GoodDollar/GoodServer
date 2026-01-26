// @flow
import Crypto from 'crypto'
import Web3 from 'web3'
import HDKey from 'hdkey'
import bip39 from 'bip39-light'
import get from 'lodash/get'
import assign from 'lodash/assign'
import chunk from 'lodash/chunk'
import * as web3Utils from 'web3-utils'
import IdentityABI from '@gooddollar/goodprotocol/artifacts/contracts/identity/IdentityV2.sol/IdentityV2.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.min.json'
import UBIABI from '@gooddollar/goodprotocol/artifacts/contracts/ubi/UBIScheme.sol/UBIScheme.json'
import ProxyContractABI from '@gooddollar/goodprotocol/artifacts/contracts/utils/AdminWalletFuse.sol/AdminWalletFuse.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import FaucetABI from '@gooddollar/goodprotocol/artifacts/contracts/fuseFaucet/FuseFaucetV2.sol/FuseFaucetV2.json'
import BuyGDFactoryABI from '@gooddollar/goodprotocol/artifacts/abis/BuyGDCloneFactory.min.json'
import BuyGDABI from '@gooddollar/goodprotocol/artifacts/abis/BuyGDClone.min.json'

import conf from '../server.config'
import logger from '../../imports/logger'
import { isNonceError, isFundsError } from '../utils/eth'
import { retry as retryAsync, withTimeout } from '../utils/async'
import { type TransactionReceipt } from './blockchain-types'

import { getManager } from '../utils/tx-manager'
import { sendSlackAlert } from '../../imports/slack'
import { KMSWallet } from './KMSWallet'
// import { HttpProviderFactory, WebsocketProvider } from './transport'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const FUSE_TX_TIMEOUT = 25000 // should be confirmed after max 5 blocks (25sec)

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

export const web3Default = {
  defaultBlock: 'latest',
  transactionBlockTimeout: 5,
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 30
}

/**
 * Exported as AdminWallet
 * Interface with blockchain contracts via web3 using HDWalletProvider
 */
export class Web3Wallet {
  // defining vars here breaks "inheritance"
  get ready() {
    return this.initialize()
  }

  constructor(name, conf, options = null, useKMS = false) {
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

  getWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    const { log } = this
    let provider
    let web3Provider
    let transport = this.ethereum.web3Transport
    switch (transport) {
      case 'WebSocket':
        provider = this.ethereum.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      case 'HttpProvider':
      default:
        provider = this.ethereum.httpWeb3Provider.split(',')[0]
        web3Provider = new Web3.providers.HttpProvider(provider, {
          timeout: FUSE_TX_TIMEOUT
        })
        break
    }

    log.debug({ conf, web3Provider, provider })

    log.debug('getWeb3TransportProvider', {
      conf: this.conf,
      web3Provider,
      provider,
      wallet: this.name,
      network: this.networkId
    })
    return web3Provider
  }

  addWalletAccount(web3, account) {
    const { eth } = web3

    eth.accounts.wallet.add(account)
    eth.defaultAccount = account.address
    // Force synchronous address validation by accessing the wallet entry
    // This ensures keccak module imports happen during initialization, not after Jest tears down
    void eth.accounts.wallet[account.address]
  }

  addWallet(account) {
    const { address } = account
    const normalizedAddress = address.toLowerCase()

    this.addWalletAccount(this.web3, account)
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
    this.web3 = new Web3(this.getWeb3TransportProvider(), null, web3Default)

    assign(this.web3.eth, web3Default)

    // Check if provider supports EIP-1559, and set maxFeePerGas/maxPriorityFeePerGas to undefined if not
    const supportsEIP1559 = await this.supportsEIP1559()
    if (!supportsEIP1559) {
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
      this.address = addresses[0]
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
          let account = this.web3.eth.accounts.privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))

          this.addWallet(account)
        }

        this.address = this.addresses[0]

        log.info('WalletInit: Initialized by mnemonic:', { address: this.addresses })
      } else if (this.conf.privateKey) {
        // Fallback to private key if mnemonic is not configured
        let account = this.web3.eth.accounts.privateKeyToAccount(this.conf.privateKey)

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

      const adminWalletContractBalance = await this.web3.eth.getBalance(adminWalletAddress)
      log.info(`WalletInit: AdminWallet contract balance`, { adminWalletContractBalance, adminWalletAddress })

      this.proxyContract = new this.web3.eth.Contract(AdminWalletABI, adminWalletAddress, { from: this.address })

      const maxAdminBalance = await this.proxyContract.methods.adminToppingAmount().call()
      const minAdminBalance = parseInt(web3Utils.fromWei(maxAdminBalance, 'gwei')) / 2

      if (web3Utils.fromWei(adminWalletContractBalance, 'gwei') < minAdminBalance * this.addresses.length) {
        log.error('AdminWallet contract low funds')
        await sendSlackAlert({
          msg: `AdminWallet contract low funds ${this.name}`,
          adminWalletAddress,
          adminWalletContractBalance
        })
      }

      this.txManager.getTransactionCount = this.web3.eth.getTransactionCount
      await this.txManager.createListIfNotExists(this.addresses)

      log.info('WalletInit: Initialized wallet queue manager')

      if (this.conf.topAdminsOnStartup) {
        log.info('WalletInit: calling topAdmins...')
        await this.topAdmins(this.conf.numberOfAdminWalletAccounts).catch(e => {
          log.warn('WalletInit: topAdmins failed', { e, errMessage: e.message })
        })
      }

      log.info('Initializing adminwallet addresses', { addresses: this.addresses })

      await Promise.all(
        this.addresses.map(async addr => {
          const balance = await this.web3.eth.getBalance(addr)
          const isAdminWallet = await this.isVerifiedAdmin(addr)

          log.info(`WalletInit: try address ${addr}:`, { balance, isAdminWallet, minAdminBalance })

          if (isAdminWallet && parseFloat(web3Utils.fromWei(balance, 'gwei')) > minAdminBalance) {
            log.info(`WalletInit: admin wallet ${addr} balance ${balance}`)
            this.filledAddresses.push(addr)
          }
        })
      )

      log.info('WalletInit: Initialized adminwallet addresses', { filled: this.filledAddresses })

      if (this.filledAddresses.length === 0) {
        log.error('WalletInit: no admin wallet with funds')

        await sendSlackAlert({
          msg: `critical: no fuse admin wallet with funds ${this.name}`
        })
      }

      this.address = this.filledAddresses[0]

      this.identityContract = new this.web3.eth.Contract(
        IdentityABI.abi,
        get(ContractsAddress, `${this.network}.Identity`, ADDRESS_ZERO),
        { from: this.address }
      )

      const oldIdentity = get(ContractsAddress, `${this.network}.IdentityOld`)
      if (oldIdentity) {
        this.oldIdentityContract = new this.web3.eth.Contract(IdentityABI.abi, oldIdentity, { from: this.address })
      }

      this.tokenContract = new this.web3.eth.Contract(
        GoodDollarABI.abi,
        get(ContractsAddress, `${this.network}.GoodDollar`, ADDRESS_ZERO),
        { from: this.address }
      )

      this.UBIContract = new this.web3.eth.Contract(
        UBIABI.abi,
        get(ContractsAddress, `${this.network}.UBIScheme`, ADDRESS_ZERO),
        {
          from: this.address
        }
      )

      this.faucetContract = new this.web3.eth.Contract(
        FaucetABI.abi,
        get(
          ContractsAddress,
          `${this.network}.FuseFaucet`,
          get(ContractsAddress, `${this.network}.Faucet`),
          ADDRESS_ZERO
        ),
        {
          from: this.address
        }
      )

      const buygdAddress = get(
        ContractsAddress,
        `${this.network}.BuyGDFactoryV2`,
        get(ContractsAddress, `${this.network}.BuyGDFactory`)
      )
      if (buygdAddress) {
        this.buygdFactoryContract = new this.web3.eth.Contract(BuyGDFactoryABI.abi, buygdAddress, {
          from: this.address
        })
      }

      let nativebalance = await this.web3.eth.getBalance(this.address)
      this.nonce = parseInt(await this.web3.eth.getTransactionCount(this.address))

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

      if (this.conf.env !== 'test' && this.conf.env !== 'development') {
        process.exit(-1)
      }
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
      const { nonce, release, fail, address } = await this.txManager.lock(this.addresses[0], 500) // timeout of 1 sec, so all "workers" fail except for the first

      try {
        log.debug('topAdmins:', { numAdmins, address, nonce })
        for (let i = 0; i < numAdmins; i += 50) {
          log.debug('topAdmins sending tx', { address, nonce, adminIdx: i })
          const tx = this.proxyContract.methods.topAdmins(i, i + 50)
          const gas = await tx
            .estimateGas()
            .then(gas => parseInt(gas) + 200000) //buffer for proxy contract, reimburseGas?
            .catch(() => 1000000)
          await this.proxyContract.methods.topAdmins(i, i + 50).send({
            gas,
            maxFeePerGas: this.maxFeePerGas,
            maxPriorityFeePerGas: this.maxPriorityFeePerGas,
            from: address,
            nonce
          })
          log.debug('topAdmins success', { adminIdx: i })
        }

        release()
      } catch (e) {
        log.error('topAdmins failed', e)
        fail()
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
        this.identityContract.methods.identities(address).call(),
        this.identityContract.methods.lastAuthenticated(address).call().then(parseInt)
      ])

      if (parseInt(identityRecord.status) === 1) {
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
        this.proxyContract.methods.whitelist(address, did, ...txExtraArgs),
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
      let encodedCall = this.web3.eth.abi.encodeFunctionCall(
        {
          name: 'authenticate',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'account'
            }
          ]
        },
        [address]
      )

      const transaction = await this.proxyContract.methods.genericCall(this.identityContract._address, encodedCall, 0)
      const tx = await this.sendTransaction(transaction, {})

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
      const result = await this.identityContract.methods.authenticationPeriod().call().then(parseInt)

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
      const result = await this.identityContract.methods.getWhitelistedOnChainId(account).call().then(parseInt)

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
        this.identityContract.methods
          .lastAuthenticated(account)
          .call()
          .then(parseInt)
          .catch(() => 0),
        this.oldIdentityContract
          ? this.oldIdentityContract.methods
              .lastAuthenticated(account)
              .call()
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

    const tx: TransactionReceipt = await this.sendTransaction(this.proxyContract.methods.blacklist(address)).catch(
      e => {
        log.error('Error blackListUser', e.message, e, { address })
        throw e
      }
    )

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
      this.proxyContract.methods.removeWhitelist(address)
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

    const tx: boolean = await this.identityContract.methods
      .isWhitelisted(address)
      .call()
      .catch(e => {
        log.error('Error isVerified', e.message, e)
        throw e
      })

    return tx
  }

  async getDID(address: string): Promise<string> {
    const { log } = this

    const tx: boolean = await this.identityContract.methods
      .addrToDID(address)
      .call()
      .catch(e => {
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

    const tx: boolean = await this.proxyContract.methods
      .isAdmin(address)
      .call()
      .catch(e => {
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
    const faucetRes = await this.topWalletFaucet(address, logger).catch(() => false)

    if (faucetRes) {
      return faucetRes
    }

    // if we reached here, either we used the faucet or user should call faucet on its own.
    let txHash = ''

    // simulate tx to detect revert
    const canTopOrError = await retryAsync(
      () =>
        this.proxyContract.methods
          .topWallet(address)
          .call()
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
      let userBalance = web3Utils.toBN(await this.web3.eth.getBalance(address))
      logger.debug('Topwallet will revert, skipping', { address, canTopOrError, wallet: this.name, userBalance })
      return false
    }

    try {
      const onTransactionHash = hash => {
        logger.debug('Topwallet got txhash:', { hash, address, wallet: this.name })
        txHash = hash
      }

      const res = await this.sendTransaction(
        this.proxyContract.methods.topWallet(address),
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
          let encodedCall = this.web3.eth.abi.encodeFunctionCall(
            {
              name: 'banAddress',
              type: 'function',
              inputs: [
                {
                  type: 'address',
                  name: 'account'
                }
              ]
            },
            [address]
          )
          return encodedCall
        })
        const contracts = addresses.map(() => this.faucetContract._address)
        const values = addresses.map(() => 0)
        const transaction = this.proxyContract.methods.genericCallBatch(contracts, datas, values)
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
    const faucetAddress = this.faucetContract?.options?.address
    if (!faucetAddress || faucetAddress === ADDRESS_ZERO) {
      logger.debug('topWalletFaucet: no valid faucet contract address', { wallet: this.name })
      return false // fall back to admin wallet topping
    }

    try {
      const canTop = await this.faucetContract.methods.canTop(address).call()

      logger.debug('topWalletFaucet canTop result:', { address, canTop, wallet: this.name })

      if (canTop === false) {
        return false //we try to top from admin wallet
      }

      let userBalance = web3Utils.toBN(await this.web3.eth.getBalance(address))
      const gasPrice = await this.web3.eth.getGasPrice()
      let faucetTxCost = web3Utils.toBN(this.faucetTxCost).mul(web3Utils.toBN(gasPrice))

      logger.debug('topWalletFaucet:', {
        address,
        userBalance: userBalance.toString(),
        faucetTxCost: faucetTxCost.toString(),
        wallet: this.name
      })

      // user can't call faucet directly
      if (forceUserToUseFaucet && userBalance.gte(faucetTxCost)) {
        logger.debug('User has enough gas to call faucet', { address, wallet: this.name })
        return true //return true so we don't call AdminWallet to topwallet
      }

      let encodedCall = this.web3.eth.abi.encodeFunctionCall(
        {
          name: 'topWallet',
          type: 'function',
          inputs: [
            {
              type: 'address',
              name: 'account'
            }
          ]
        },
        [address]
      )

      const transaction = this.proxyContract.methods.genericCall(this.faucetContract._address, encodedCall, 0)
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
      let encodedCall = this.web3.eth.abi.encodeFunctionCall(
        {
          name: 'fishMulti',
          type: 'function',
          inputs: [
            {
              type: 'address[]',
              name: '_accounts'
            }
          ]
        },
        [toFish]
      )

      logger.info('fishMulti sending tx', { encodedCall, toFish, ubischeme: this.UBIContract._address })

      const transaction = await this.proxyContract.methods.genericCall(this.UBIContract._address, encodedCall, 0)
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
    const predictedAddress = await this.buygdFactoryContract.methods.predict(address).call()
    const isHelperDeployed = await this.web3.eth.getCode(predictedAddress).then(code => code !== '0x')

    try {
      let swapResult
      if (isHelperDeployed) {
        const buygdContract = new this.web3.eth.Contract(BuyGDABI.abi, predictedAddress)
        //simulate tx
        const estimatedGas = await buygdContract.methods
          .swap(0, this.proxyContract._address)
          .estimateGas()
          .then(_ => parseInt(_) + 200000)

        let encodedCall = this.web3.eth.abi.encodeFunctionCall(
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
          },
          [0, this.proxyContract._address]
        )

        const transaction = this.proxyContract.methods.genericCall(predictedAddress, encodedCall, 0)
        const onTransactionHash = hash =>
          void logger.debug('swaphelper swap got txhash:', { estimatedGas, hash, address, wallet: this.name })
        swapResult = await this.sendTransaction(transaction, { onTransactionHash }, { gas: estimatedGas }, true, logger)
      } else {
        //simulate tx
        const estimatedGas = await this.buygdFactoryContract.methods
          .createAndSwap(address, 0)
          .estimateGas()
          .then(_ => parseInt(_) + 200000)
        let encodedCall = this.web3.eth.abi.encodeFunctionCall(
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
          },
          [address, 0]
        )

        const transaction = this.proxyContract.methods.genericCall(this.buygdFactoryContract._address, encodedCall, 0)
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
      let encodedCall = this.web3.eth.abi.encodeFunctionCall(
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
        },
        [to, value]
      )
      logger.info('transferWalletGoodDollars sending tx', { encodedCall, to, value })

      const transaction = await this.proxyContract.methods.genericCall(this.tokenContract._address, encodedCall, 0)
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
    return this.web3.eth.getBalance(address)
  }

  /**
   * get balance for admin wallet
   * @returns {Promise<number>}
   */
  async getBalance(): Promise<number> {
    const { log } = this

    return this.getAddressBalance(this.address)
      .then(b => parseFloat(web3Utils.fromWei(b)))
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
      let encodedCall = this.web3.eth.abi.encodeFunctionCall(
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
        },
        [account, '0x']
      )

      const transaction = await this.proxyContract.methods.genericCall(poolAddress, encodedCall, 0)
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
    const result = await this.web3.eth.getFeeHistory('0x5', 'latest', [10])

    const baseFees = result.baseFeePerGas.map(hex => parseInt(hex, 16))
    const rewards = result.reward.map(r => parseInt(r[0], 16)) // 10th percentile

    const latestBaseFee = baseFees[baseFees.length - 1]
    const minPriorityFee = Math.min(...rewards)

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
    // Use instance defaults if not provided
    gasPrice = gasPrice || this.gasPrice
    maxFeePerGas = maxFeePerGas !== undefined ? maxFeePerGas : this.maxFeePerGas
    maxPriorityFeePerGas = maxPriorityFeePerGas !== undefined ? maxPriorityFeePerGas : this.maxPriorityFeePerGas

    // Convert string values to numbers for comparison
    const maxFeeNum = maxFeePerGas ? (typeof maxFeePerGas === 'string' ? parseInt(maxFeePerGas) : maxFeePerGas) : 0
    const maxPriorityNum = maxPriorityFeePerGas
      ? typeof maxPriorityFeePerGas === 'string'
        ? parseInt(maxPriorityFeePerGas)
        : maxPriorityFeePerGas
      : 0

    // Decide between legacy gasPrice and EIP-1559 fees
    if (gasPrice && !maxFeeNum && !maxPriorityNum) {
      logger.info('using legacy gasPrice tx')
    } else {
      gasPrice = undefined
    }

    // Fetch fee estimates if EIP-1559 fees are not provided or invalid
    if (!gasPrice && (!maxFeeNum || !maxPriorityNum)) {
      const { baseFee, priorityFee } = await this.getFeeEstimates()
      maxFeePerGas = maxFeeNum || baseFee
      maxPriorityFeePerGas = maxPriorityNum || priorityFee
    }

    // Ensure maxFeePerGas >= maxPriorityFeePerGas (EIP-1559 requirement)
    // Convert to numbers for comparison (handle both string and number types, and 0 values)
    const finalMaxFee =
      maxFeePerGas !== undefined && maxFeePerGas !== null
        ? typeof maxFeePerGas === 'string'
          ? parseInt(maxFeePerGas) || 0
          : maxFeePerGas
        : 0
    const finalMaxPriority =
      maxPriorityFeePerGas !== undefined && maxPriorityFeePerGas !== null
        ? typeof maxPriorityFeePerGas === 'string'
          ? parseInt(maxPriorityFeePerGas) || 0
          : maxPriorityFeePerGas
        : 0

    // If both are set and maxFeePerGas is invalid (0 or less than maxPriorityFeePerGas), adjust it
    if (finalMaxPriority > 0 && (finalMaxFee === 0 || finalMaxFee < finalMaxPriority)) {
      logger.warn('maxFeePerGas < maxPriorityFeePerGas or is 0, adjusting maxFeePerGas', {
        originalMaxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        adjustedMaxFeePerGas: maxPriorityFeePerGas
      })
      // Set maxFeePerGas to at least maxPriorityFeePerGas
      maxFeePerGas = maxPriorityFeePerGas
    }

    return { gasPrice, maxFeePerGas, maxPriorityFeePerGas }
  }

  /**
   * Check if the RPC supports EIP-1559 using multiple methods:
   * Check chain ID against known EIP-1559 supporting networks
   * @returns Promise resolving to boolean indicating EIP-1559 support
   */
  async supportsEIP1559(): Promise<boolean> {
    const { log } = this
    try {
      const web3 = this.web3
      if (!web3) {
        log.warn('No web3 instance available for EIP-1559 check')
        return false
      }

      const chainId = await web3.eth.getChainId()
      const knownEIP1559Chains = new Set([
        1, // Ethereum Mainnet
        11155111, // Ethereum Sepolia
        8453, // Base
        137, // Polygon
        42161, // Arbitrum One
        10, // Optimism
        5, // Goerli
        80001 // Mumbai (Polygon testnet)
      ])

      if (knownEIP1559Chains.has(chainId)) {
        // For known EIP-1559 chains, verify with block check
        // Ethereum Mainnet requires block >= 12965000 (London fork)
        if (chainId === 1) {
          const latestBlock = await web3.eth.getBlock('latest')
          const londonForkBlock = 12965000
          if (latestBlock.number < londonForkBlock) {
            log.debug('Ethereum Mainnet block number indicates pre-London fork', {
              blockNumber: latestBlock.number,
              londonForkBlock
            })
            return false
          }
        }
        return true
      }

      return false
    } catch (error) {
      log.warn('Failed to check EIP-1559 support, assuming legacy network', {
        error: error.message,
        networkId: this.networkId
      })
      // If we can't check, assume it doesn't support EIP-1559 (safer fallback)
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

    // Extract transaction data from Web3 contract method
    const txData = tx.encodeABI()
    const to = tx._parent._address || tx._parent.options.address

    // Extract value if present (for payable functions like WETH deposit)
    // Value can be passed via txParams.value, tx.value, or tx._parent.options.value
    const value = txParams.value || tx.value || tx._parent?.options?.value || '0'

    // Build transaction parameters for KMS
    const kmsTxParams = {
      to,
      data: txData,
      nonce,
      chainId,
      gasLimit: gas.toString(),
      rpcUrl: this.ethereum.httpWeb3Provider ? this.ethereum.httpWeb3Provider.split(',')[0] : undefined
    }

    // Add value if non-zero (for payable functions)
    // kms-ethereum-signing expects value as a decimal string
    if (value && value !== '0' && value !== 0) {
      kmsTxParams.value = value
    }

    // Check if the RPC supports EIP-1559. If it doesn't, remove maxFeePerGas
    // to use the legacy gasPrice field instead
    const supportsEIP1559 = await this.supportsEIP1559()
    let adjustedMaxFeePerGas = maxFeePerGas
    let adjustedMaxPriorityFeePerGas = maxPriorityFeePerGas
    if (!supportsEIP1559) {
      logger.debug('Network does not support EIP-1559, removing maxFeePerGas', { chainId })
      adjustedMaxFeePerGas = undefined
      adjustedMaxPriorityFeePerGas = undefined
    }

    // Add gas pricing
    if (adjustedMaxFeePerGas && adjustedMaxPriorityFeePerGas) {
      kmsTxParams.maxFeePerGas = adjustedMaxFeePerGas.toString()
      kmsTxParams.maxPriorityFeePerGas = adjustedMaxPriorityFeePerGas.toString()
    } else if (gasPrice) {
      kmsTxParams.gasPrice = gasPrice.toString()
    }

    // Sign transaction with KMS
    logger.debug('Signing transaction with KMS', { address, chainId, supportsEIP1559 })
    const signedTx = await this.kmsWallet.signTransaction(address, kmsTxParams)

    return signedTx
  }

  /**
   * Wrap a PromiEvent with shared event handlers
   * @private
   */
  _wrapPromiEventWithHandlers(
    promiEvent: PromiEvent,
    txCallbacks: PromiEvents,
    context: {
      release: Function,
      txuuid: string,
      logger: any,
      txHash?: string,
      address?: string,
      nonce?: number,
      gas?: number,
      maxFeePerGas?: string,
      maxPriorityFeePerGas?: string
    },
    options: {
      fail?: Function,
      onSent?: Function,
      checkFundsError?: boolean
    } = {}
  ): Promise<TransactionReceipt> {
    const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks
    const { release, txuuid, logger, address, nonce, gas, maxFeePerGas, maxPriorityFeePerGas } = context
    const { fail, onSent, checkFundsError } = options

    return new Promise((res, rej) => {
      // Verify promiEvent is actually a PromiEvent (has .on method)
      if (!promiEvent || typeof promiEvent.on !== 'function') {
        const error = new Error(
          `Expected PromiEvent but got ${typeof promiEvent}${promiEvent?.constructor?.name ? ` (${promiEvent.constructor.name})` : ''}. This may indicate the PromiEvent was already resolved.`
        )
        logger.error('Invalid PromiEvent in _wrapPromiEventWithHandlers', {
          type: typeof promiEvent,
          hasOn: promiEvent && typeof promiEvent.on,
          constructor: promiEvent?.constructor?.name,
          keys: promiEvent ? Object.keys(promiEvent).slice(0, 10) : null,
          txuuid
        })
        rej(error)
        return
      }

      promiEvent
        .on('transactionHash', h => {
          context.txHash = h
          logger.trace('got tx hash:', { txuuid, txHash: h, wallet: this.name })
          release()

          if (onTransactionHash) {
            onTransactionHash(h)
          }
        })
        .on('sent', payload => {
          if (onSent) {
            onSent(payload)
          }
          logger.debug('tx sent:', { txHash: context.txHash, payload, txuuid, wallet: this.name })
        })
        .on('receipt', r => {
          logger.debug('got tx receipt:', { txuuid, txHash: r.transactionHash, wallet: this.name })

          if (onReceipt) {
            onReceipt(r)
          }

          res(r)
        })
        .on('confirmation', c => {
          if (onConfirmation) {
            onConfirmation(c)
          }
        })
        .on('error', async e => {
          // Check for funds error if requested (for non-KMS transactions)
          if (checkFundsError && isFundsError(e) && address) {
            const balance = await this.web3.eth.getBalance(address)
            logger.warn('sendTransaciton funds issue retry', {
              errMessage: e.message,
              nonce,
              gas,
              maxFeePerGas,
              maxPriorityFeePerGas,
              address,
              balance,
              wallet: this.name,
              network: this.networkId
            })
          }

          // Call fail callback if provided (for mainnet error handling)
          if (fail) {
            fail()
          }

          logger.error('Transaction error:', { txuuid, error: e.message, wallet: this.name })

          if (onError) {
            onError(e)
          }

          rej(e)
        })
    })
  }

  /**
   * Send transaction using KMS signing (kept for backward compatibility)
   * @private
   * @param {Object} options - Additional options for mainnet transactions
   * @param {Function} options.fail - Optional fail callback for error handling
   */
  async sendTransactionWithKMS(
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
    },
    txCallbacks: PromiEvents,
    context: {
      release: Function,
      currentAddress: string,
      txuuid: string,
      logger: any
    },
    options: {
      fail?: Function
    } = {}
  ) {
    const { release, txuuid, logger } = context
    const { fail } = options

    try {
      // Sign transaction with KMS, then create PromiEvent synchronously
      const signedTx = await this._signTransactionWithKMS(tx, address, txParams)
      const promiEvent = this.web3.eth.sendSignedTransaction(signedTx)

      return this._wrapPromiEventWithHandlers(promiEvent, txCallbacks, { release, txuuid, logger }, { fail })
    } catch (error) {
      // Call fail callback if provided (for mainnet error handling)
      if (fail) {
        fail()
      }
      release()
      logger.error('Failed to send transaction with KMS', {
        txuuid,
        address,
        error: error.message,
        wallet: this.name
      })
      throw error
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
  async sendTransaction(
    tx: any,
    txCallbacks: PromiEvents = {},
    { gas, maxPriorityFeePerGas, maxFeePerGas, gasPrice }: GasValues = {
      gas: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined
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
        (await tx
          .estimateGas()
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

      logger.trace('getting tx lock:', { txuuid })

      const { nonce, release, address } = await this.txManager.lock(this.filledAddresses)

      logger.trace('got tx lock:', { txuuid, address })

      let balance = NaN

      if (this.conf.env === 'development') {
        balance = await this.web3.eth.getBalance(address)
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

      // Extract value if present (for payable functions)
      const txValue = tx.value || tx._parent?.options?.value

      // Get PromiEvent - either from KMS signing or regular signing
      let promiEvent
      if (this.isKMSWallet(address) && this.kmsWallet) {
        // Sign transaction with KMS, then create PromiEvent synchronously
        const signedTx = await this._signTransactionWithKMS(tx, address, {
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasPrice,
          nonce,
          chainId: this.networkId,
          value: txValue
        })
        promiEvent = this.web3.eth.sendSignedTransaction(signedTx)
      } else {
        // Use traditional signing flow
        const sendParams = {
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasPrice,
          chainId: this.networkId,
          nonce,
          from: address
        }
        if (txValue) {
          sendParams.value = txValue
        }
        promiEvent = tx.send(sendParams)
      }

      // Wrap PromiEvent with shared event handlers
      const txPromise = this._wrapPromiEventWithHandlers(
        promiEvent,
        txCallbacks,
        {
          release,
          txuuid,
          logger,
          address,
          nonce,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas
        },
        {
          onSent: payload => {
            txHash = payload?.transactionHash || txHash
          },
          checkFundsError: !this.isKMSWallet(address) // Only check funds errors for non-KMS
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
      let netNonce = parseInt(await this.web3.eth.getTransactionCount(currentAddress))

      //check if tx did go through after timeout or not
      if (txHash && e.message.toLowerCase().includes('timeout')) {
        // keeping address locked for another 30 seconds
        retryAsync(
          async attempt => {
            const receipt = await this.web3.eth.getTransactionReceipt(txHash).catch()
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
              await this.txManager.unlock(currentAddress, currentNonce + 1)
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
      } else if (retry && (e.message.includes('FeeTooLowToCompete') || e.message.includes('underpriced'))) {
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
        await this.txManager.unlock(currentAddress, currentNonce + 1)

        return this.sendTransaction(
          tx,
          txCallbacks,
          { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas },
          false,
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
          { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas },
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
    { gas, maxFeePerGas, maxPriorityFeePerGas, gasPrice }: GasValues = {
      gas: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      gasPrice: undefined
    }
  ) {
    let currentAddress
    const { log } = this

    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

      gas = gas || defaultGas

      // Normalize gas pricing (deduplicated logic)
      const normalizedGas = await this.normalizeGasPricing({ gasPrice, maxFeePerGas, maxPriorityFeePerGas }, log)
      gasPrice = normalizedGas.gasPrice
      maxFeePerGas = normalizedGas.maxFeePerGas
      maxPriorityFeePerGas = normalizedGas.maxPriorityFeePerGas

      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)

      log.debug('sendNative', { nonce, gas, maxFeePerGas, maxPriorityFeePerGas })
      currentAddress = address

      return new Promise((res, rej) => {
        this.web3.eth
          .sendTransaction({
            gas,
            gasPrice,
            maxFeePerGas,
            maxPriorityFeePerGas,
            chainId: this.networkId,
            nonce,
            ...params,
            from: address
          })
          .on('transactionHash', h => {
            if (onTransactionHash) {
              onTransactionHash(h)
            }

            release()
          })
          .on('receipt', r => {
            if (onReceipt) {
              onReceipt(r)
            }

            res(r)
          })
          .on('confirmation', c => {
            if (onConfirmation) {
              onConfirmation(c)
            }
          })
          .on('error', async e => {
            const { message } = e

            if (isNonceError(e)) {
              let netNonce = parseInt(await this.web3.eth.getTransactionCount(address))

              log.warn('sendNative nonce failure retry', message, e, {
                params,
                nonce,
                gas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                address,
                newNonce: netNonce,
                wallet: this.name,
                network: this.networkId
              })

              await this.txManager.unlock(address, netNonce)

              try {
                await this.sendNative(params, txCallbacks, { gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas }).then(
                  res
                )
              } catch (e) {
                rej(e)
              }
            } else {
              fail()

              if (onError) {
                onError(e)
              }

              log.error('sendNative failed', message, e, { wallet: this.name, network: this.networkId })
              rej(e)
            }
          })
      })
    } catch (e) {
      let netNonce = parseInt(await this.web3.eth.getTransactionCount(currentAddress))
      await this.txManager.unlock(currentAddress, netNonce)
      throw new Error(e)
    }
  }
}

// @flow
import Crypto from 'crypto'
import Web3 from 'web3'
import HDKey from 'hdkey'
import bip39 from 'bip39-light'
import get from 'lodash/get'
import assign from 'lodash/assign'
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
// import { HttpProviderFactory, WebsocketProvider } from './transport'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const FUSE_TX_TIMEOUT = 25000 // should be confirmed after max 5 blocks (25sec)

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

  constructor(name, conf, options = null) {
    const {
      ethereum = null,
      network = null,
      maxFeePerGas = undefined,
      maxPriorityFeePerGas = undefined,
      faucetTxCost = 150000
    } = options || {}
    const ethOpts = ethereum || conf.ethereum
    const { network_id: networkId } = ethOpts

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
    this.numberOfAdminWalletAccounts = conf.privateKey ? 1 : conf.numberOfAdminWalletAccounts
    this.maxFeePerGas = maxFeePerGas
    this.maxPriorityFeePerGas = maxPriorityFeePerGas
    this.log = logger.child({ from: `${name}/${this.networkId}` })

    this.initialize()
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

  // getWeb3TransportProvider(): HttpProvider | WebSocketProvider {
  //   let provider
  //   let web3Provider
  //   const { web3Transport, websocketWeb3Provider, httpWeb3Provider } = this.ethereum
  //   const { log } = this

  //   switch (web3Transport) {
  //     case 'WebSocket':
  //       provider = websocketWeb3Provider
  //       web3Provider = new WebsocketProvider(provider)
  //       break

  //     case 'HttpProvider':
  //     default: {
  //       provider = httpWeb3Provider
  //       web3Provider = HttpProviderFactory.create(provider, {
  //         timeout: FUSE_TX_TIMEOUT
  //       })
  //       break
  //     }
  //   }

  //   log.debug({ conf: this.conf, web3Provider, provider, wallet: this.name, network: this.networkId })
  //   return web3Provider
  // }

  addWalletAccount(web3, account) {
    const { eth } = web3

    eth.accounts.wallet.add(account)
    eth.defaultAccount = account.address
  }

  addWallet(account) {
    const { address } = account

    this.addWalletAccount(this.web3, account)
    this.addresses.push(address)
    this.wallets[address] = account
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

    if (this.conf.privateKey) {
      let account = this.web3.eth.accounts.privateKeyToAccount(this.conf.privateKey)

      this.address = account.address
      this.addWallet(account)

      log.info('WalletInit: Initialized by private key:', { address: account.address })
    } else if (this.mnemonic) {
      let root = HDKey.fromMasterSeed(bip39.mnemonicToSeed(this.mnemonic, this.conf.adminWalletPassword))

      for (let i = 0; i < this.numberOfAdminWalletAccounts; i++) {
        const path = "m/44'/60'/0'/0/" + i
        let addrNode = root.derive(path)
        let account = this.web3.eth.accounts.privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))

        this.addWallet(account)
      }

      this.address = this.addresses[0]

      log.info('WalletInit: Initialized by mnemonic:', { address: this.addresses })
    }
    try {
      log.info('WalletInit: Obtained AdminWallet address', { adminWalletAddress, network: this.network })

      const adminWalletContractBalance = await this.web3.eth.getBalance(adminWalletAddress)
      log.info(`WalletInit: AdminWallet contract balance`, { adminWalletContractBalance, adminWalletAddress })

      this.proxyContract = new this.web3.eth.Contract(ProxyContractABI.abi, adminWalletAddress, { from: this.address })

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

  async topWalletFaucet(address, customLogger = null) {
    const logger = customLogger || this.log
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
    { gas, maxPriorityFeePerGas, maxFeePerGas }: GasValues = {
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
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

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

      maxFeePerGas = maxFeePerGas || this.maxFeePerGas
      maxPriorityFeePerGas = maxPriorityFeePerGas || this.maxPriorityFeePerGas

      if (!maxFeePerGas || !maxPriorityFeePerGas) {
        const { baseFee, priorityFee } = await this.getFeeEstimates()
        maxFeePerGas = maxFeePerGas || baseFee
        maxPriorityFeePerGas = maxPriorityFeePerGas || priorityFee
      }
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
        wallet: this.name
      })

      let txPromise = new Promise((res, rej) => {
        tx.send({ gas, maxFeePerGas, maxPriorityFeePerGas, chainId: this.networkId, nonce, from: address })
          .on('transactionHash', h => {
            txHash = h
            logger.trace('got tx hash:', { txuuid, txHash, wallet: this.name })

            if (onTransactionHash) {
              onTransactionHash(h)
            }
          })
          .on('sent', payload => {
            release()
            logger.debug('tx sent:', { txHash, payload, txuuid, wallet: this.name })
          })
          .on('receipt', r => {
            logger.debug('got tx receipt:', { txuuid, txHash, wallet: this.name })

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
            if (isFundsError(e)) {
              balance = await this.web3.eth.getBalance(address)

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

            //we maually unlock in catch
            //fail()

            if (onError) {
              onError(e)
            }

            rej(e)
          })
      })

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

        return this.sendTransaction(tx, txCallbacks, { gas, maxFeePerGas, maxPriorityFeePerGas }, false, logger)
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
        return this.sendTransaction(tx, txCallbacks, { gas, maxFeePerGas, maxPriorityFeePerGas }, false, logger)
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
    { gas, maxFeePerGas, maxPriorityFeePerGas }: GasValues = {
      gas: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined
    }
  ) {
    let currentAddress
    const { log } = this

    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

      gas = gas || defaultGas
      maxFeePerGas = maxFeePerGas || this.maxFeePerGas
      maxPriorityFeePerGas = maxPriorityFeePerGas || this.maxPriorityFeePerGas

      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)

      log.debug('sendNative', { nonce, gas, maxFeePerGas, maxPriorityFeePerGas })
      currentAddress = address

      return new Promise((res, rej) => {
        this.web3.eth
          .sendTransaction({
            gas,
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
                await this.sendNative(params, txCallbacks, { gas, maxFeePerGas, maxPriorityFeePerGas }).then(res)
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

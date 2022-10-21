// @flow
import Crypto from 'crypto'
import Web3 from 'web3'
import HDKey from 'hdkey'
import bip39 from 'bip39-light'
import get from 'lodash/get'
import assign from 'lodash/assign'
import * as web3Utils from 'web3-utils'
import IdentityABI from '@gooddollar/goodcontracts/build/contracts/Identity.min.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.min.json'
import UBIABI from '@gooddollar/goodprotocol/artifacts/contracts/ubi/UBIScheme.sol/UBIScheme.json'
import ProxyContractABI from '@gooddollar/goodcontracts/build/contracts/AdminWallet.min.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import FaucetABI from '@gooddollar/goodcontracts/upgradables/build/contracts/FuseFaucet.min.json'

import conf from '../server.config'
import logger from '../../imports/logger'
import { isNonceError, isFundsError } from '../utils/eth'
import { withTimeout } from '../utils/async'
import { type TransactionReceipt } from './blockchain-types'

import { getManager } from '../utils/tx-manager'
import { sendSlackAlert } from '../../imports/slack'

const FUSE_TX_TIMEOUT = 25000 // should be confirmed after max 5 blocks (25sec)
const { estimateGasPrice } = conf
const defaultGasPrice = web3Utils.toWei(String(conf.defaultGasPrice), 'gwei')

export const adminMinBalance = conf.adminMinBalance

export const defaultGas = 200000

export const web3Default = {
  defaultBlock: 'latest',
  defaultGasPrice,
  transactionBlockTimeout: 5,
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 30
}

export const getAuthHeader = rpc => {
  const url = new URL(rpc)

  if (!url.password) {
    return []
  }

  return [
    {
      name: 'Authorization',
      value: `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}`
    }
  ]
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
    const { ethereum = null, network = null, initialGasPrice = null, lazyInitialize = false } = options || {}
    const ethOpts = ethereum || conf.ethereum

    this.addresses = []
    this.filledAddresses = []
    this.wallets = {}
    this.conf = conf
    this.mnemonic = conf.mnemonic
    this.network = network || conf.network
    this.ethereum = ethOpts
    this.networkId = ethOpts.network_id
    this.numberOfAdminWalletAccounts = conf.privateKey ? 1 : conf.numberOfAdminWalletAccounts
    this.gasPrice = initialGasPrice || defaultGasPrice
    this.log = logger.child({ from: `${name}/${this.networkId}` })

    if (!lazyInitialize) {
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
    let provider
    let web3Provider
    let transport = this.ethereum.web3Transport
    const { log } = this

    switch (transport) {
      case 'WebSocket':
        provider = this.ethereum.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      case 'HttpProvider':
      default: {
        provider = this.ethereum.httpWeb3Provider

        const headers = getAuthHeader(provider)

        web3Provider = new Web3.providers.HttpProvider(provider, {
          timeout: FUSE_TX_TIMEOUT,
          headers
        })
        break
      }
    }

    log.debug({ conf: this.conf, web3Provider, provider })
    return web3Provider
  }

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

    log.debug('Initializing wallet:', { conf: this.ethereum })

    this.txManager = getManager(this.ethereum.network_id)
    this.web3 = new Web3(this.getWeb3TransportProvider(), null, web3Default)

    assign(this.web3.eth, web3Default)

    if (estimateGasPrice) {
      await this.web3.eth
        .getGasPrice()
        .then(price => (this.gasPrice = price))
        .catch(e => log.warn('failed to get gas price', e.message, e))
    }

    if (this.conf.privateKey) {
      let account = this.web3.eth.accounts.privateKeyToAccount(this.conf.privateKey)

      this.address = account.address
      this.addWallet(account)

      log.info('Initialized by private key:', { address: account.address })
    } else if (this.mnemonic) {
      let root = HDKey.fromMasterSeed(bip39.mnemonicToSeed(this.mnemonic, this.conf.adminWalletPassword))

      for (let i = 0; i < this.numberOfAdminWalletAccounts; i++) {
        const path = "m/44'/60'/0'/0/" + i
        let addrNode = root.derive(path)
        let account = this.web3.eth.accounts.privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))

        this.addWallet(account)
      }

      log.info('Initialized by mnemonic:', { address: this.addresses })
    }

    const adminWalletAddress = get(ContractsAddress, `${this.network}.AdminWallet`)
    log.info('Obtained AdminWallet address', { adminWalletAddress, network: this.network })

    const adminWalletContractBalance = await this.web3.eth.getBalance(adminWalletAddress)
    log.info(`AdminWallet contract balance`, { adminWalletContractBalance, adminWalletAddress })

    this.proxyContract = new this.web3.eth.Contract(ProxyContractABI.abi, adminWalletAddress, { from: this.address })

    const maxAdminBalance = await this.proxyContract.methods.adminToppingAmount().call()
    const minAdminBalance = parseInt(web3Utils.fromWei(maxAdminBalance, 'gwei')) / 2

    if (web3Utils.fromWei(adminWalletContractBalance, 'gwei') < minAdminBalance * this.addresses.length) {
      log.error('AdminWallet contract low funds')
      sendSlackAlert({ msg: 'AdminWallet contract low funds', adminWalletAddress, adminWalletContractBalance })

      if (this.conf.env !== 'test' && this.conf.env !== 'development') {
        process.exit(-1)
      }
    }

    this.txManager.getTransactionCount = this.web3.eth.getTransactionCount
    await this.txManager.createListIfNotExists(this.addresses)

    log.info('Initialized wallet queue manager')

    if (this.conf.topAdminsOnStartup) {
      await this.topAdmins(0, this.conf.numberOfAdminWalletAccounts).catch(e => {
        log.warn('Top admins failed', { e, errMessage: e.message })
      })
    }

    log.info('Initializing adminwallet addresses', { addresses: this.addresses })

    await Promise.all(
      this.addresses.map(async addr => {
        const balance = await this.web3.eth.getBalance(addr)
        const isAdminWallet = await this.isVerifiedAdmin(addr)

        log.info(`try address ${addr}:`, { balance, isAdminWallet, minAdminBalance })

        if (isAdminWallet && parseFloat(web3Utils.fromWei(balance, 'gwei')) > minAdminBalance) {
          log.info(`admin wallet ${addr} balance ${balance}`)
          this.filledAddresses.push(addr)
        }
      })
    )

    log.info('Initialized adminwallet addresses', { filled: this.filledAddresses })

    if (this.filledAddresses.length === 0) {
      log.error('no admin wallet with funds')

      sendSlackAlert({
        msg: 'critical: no fuse admin wallet with funds'
      })

      if (this.conf.env !== 'test' && this.conf.env !== 'development') {
        process.exit(-1)
      }
    }

    this.address = this.filledAddresses[0]

    this.identityContract = new this.web3.eth.Contract(
      IdentityABI.abi,
      get(ContractsAddress, `${this.network}.Identity`),
      { from: this.address }
    )

    this.tokenContract = new this.web3.eth.Contract(
      GoodDollarABI.abi,
      get(ContractsAddress, `${this.network}.GoodDollar`),
      { from: this.address }
    )

    this.UBIContract = new this.web3.eth.Contract(UBIABI.abi, get(ContractsAddress, `${this.network}.UBIScheme`), {
      from: this.address
    })

    this.faucetContract = new this.web3.eth.Contract(
      FaucetABI.abi,
      get(ContractsAddress, `${this.network}.FuseFaucet`),
      {
        from: this.address
      }
    )

    try {
      let gdbalance = await this.tokenContract.methods
        .balanceOf(this.address)
        .call()
        .then(parseInt)

      let nativebalance = await this.web3.eth.getBalance(this.address)
      this.nonce = parseInt(await this.web3.eth.getTransactionCount(this.address))

      log.debug('AdminWallet Ready:', {
        activeWallets: this.filledAddresses.length,
        account: this.address,
        gdbalance,
        nativebalance,
        networkId: this.networkId,
        network: this.network,
        nonce: this.nonce,
        ContractsAddress: ContractsAddress[this.network]
      })
    } catch (e) {
      log.error('Error initializing wallet', e.message, e)

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
      const { nonce, release, fail, address } = await this.txManager.lock(this.addresses[0])

      try {
        for (let i = 0; i < numAdmins; i += 50) {
          log.debug('topAdmins sending tx', { address, nonce, adminIdx: i })
          await this.proxyContract.methods.topAdmins(i, i + 50).send({ gas: '500000', from: address, nonce })
          log.debug('topAdmins success', { adminIdx: i })
        }

        release()
      } catch (e) {
        fail()
        log.error('topAdmins failed', e)
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
  async whitelistUser(address: string, did: string, customLogger): Promise<TransactionReceipt | boolean> {
    const log = customLogger || this.log
    const isVerified = await this.isVerified(address)

    if (isVerified) {
      return { status: true }
    }

    let txHash

    try {
      const lastAuth = await this.identityContract.methods
        .lastAuthenticated(address)
        .call()
        .then(parseInt)

      if (lastAuth > 0) {
        //user was already whitelisted in the past, just needs re-authentication
        return this.authenticateUser(address)
      }

      const onTransactionHash = hash => {
        log.debug('WhitelistUser got txhash:', { hash, address, did })
        txHash = hash
      }

      const txPromise = this.sendTransaction(this.proxyContract.methods.whitelist(address, did), {
        onTransactionHash
      })

      let tx = await txPromise

      log.info('Whitelisted user', { txHash, address, did, tx })
      return tx
    } catch (exception) {
      const { message } = exception

      log.warn('Error whitelistUser', message, exception, { txHash, address, did })
      throw exception
    }
  }

  async authenticateUser(address: string): Promise<TransactionReceipt> {
    const { log } = this

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
      const tx = await this.sendTransaction(transaction, {}, { gas: 500000 })

      log.info('authenticated user', { address, tx })
      return tx
    } catch (exception) {
      const { message } = exception

      log.warn('Error authenticateUser', message, exception, { address })
      throw exception
    }
  }

  async getAuthenticationPeriod(): Promise<number> {
    const { log } = this

    try {
      const result = await this.identityContract.methods
        .authenticationPeriod()
        .call()
        .then(parseInt)

      return result
    } catch (exception) {
      const { message } = exception

      log.warn('Error getAuthenticationPeriod', message, exception)
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
    const canTopOrError = await this.proxyContract.methods
      .topWallet(address)
      .call()
      .then(() => true)
      .catch(e => e)

    if (canTopOrError !== true) {
      logger.debug('Topwallet will revert, skipping', { address, canTopOrError })
      throw new Error('Topwallet will revert, probably user passed limit')
    }

    try {
      const onTransactionHash = hash => {
        logger.debug('Topwallet got txhash:', { hash, address })
        txHash = hash
      }

      const res = await this.sendTransaction(
        this.proxyContract.methods.topWallet(address),
        { onTransactionHash },
        { gas: 500000 },
        true,
        logger
      )

      logger.debug('Topwallet result:', { txHash, address, res })
      return res
    } catch (e) {
      logger.error('Error topWallet', e.message, e, { txHash, address })
      throw e
    }
  }

  async topWalletFaucet(address, customLogger = null) {
    const logger = customLogger || this.log

    try {
      const canTop = await this.faucetContract.methods.canTop(address).call()

      logger.debug('topWalletFaucet canTop result:', { address, canTop })

      if (canTop === false) {
        return false
      }

      let userBalance = web3Utils.toBN(await this.web3.eth.getBalance(address))
      let faucetTxCost = web3Utils.toBN('150000').mul(web3Utils.toBN(this.gasPrice))

      logger.debug('topWalletFaucet:', {
        address,
        userBalance: userBalance.toString(),
        faucetTxCost: faucetTxCost.toString()
      })

      // user can't call faucet directly
      if (userBalance.gte(faucetTxCost)) {
        logger.debug('User has enough gas to call faucet', { address })
        return true
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
      const onTransactionHash = hash => void logger.debug('topWalletFaucet got txhash:', { hash, address })
      const res = await this.sendTransaction(transaction, { onTransactionHash }, { gas: 500000 }, true, logger)

      logger.debug('topWalletFaucet result:', { address, res })
      return res
    } catch (e) {
      logger.error('Error topWalletFaucet', e.message, e, { address })
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

  /**
   * transfer G$s locked in adminWallet contract to recipient
   * @param {*} to recipient
   * @param {*} value amount to transfer
   * @param {*} logger
   * @returns
   */
  async transferWalletGooDollars(to, value, customLogger = null): Promise<TransactionReceipt> {
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
      logger.info('transferWalletGooDollars sending tx', { encodedCall, to, value })

      const transaction = await this.proxyContract.methods.genericCall(this.tokenContract._address, encodedCall, 0)
      const tx = await this.sendTransaction(transaction, {}, { gas: 200000 }, false, logger)

      logger.info('transferWalletGooDollars success', { to, value, tx: tx.transactionHash })
      return tx
    } catch (exception) {
      const { message } = exception

      logger.error('transferWalletGooDollars failed', message, exception, { to, value })
      throw exception
    }
  }

  async getAddressBalance(address: string): Promise<number> {
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
   * @param {number} gasValues.gasPrice
   * @returns {Promise<Promise|Q.Promise<any>|Promise<*>|Promise<*>|Promise<*>|*>}
   */
  async sendTransaction(
    tx: any,
    txCallbacks: PromiEvents = {},
    { gas, gasPrice }: GasValues = { gas: undefined, gasPrice: undefined },
    retry = true,
    customLogger = null
  ) {
    let currentAddress, txHash
    const uuid = Crypto.randomBytes(5).toString('base64')
    const logger = customLogger || this.log

    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

      gas =
        gas ||
        (await tx
          .estimateGas()
          .then(gas => parseInt(gas) + 200000) //buffer for proxy contract, reimburseGas?
          .catch(e => {
            logger.warn('Failed to estimate gas for tx', e.message, e)
            return defaultGas
          }))

      // adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) {
        gas = defaultGas
      }

      gasPrice = gasPrice || this.gasPrice

      logger.debug('getting tx lock:', { uuid })

      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)

      logger.debug('got tx lock:', { uuid, address })

      let balance = NaN

      if (this.conf.env === 'development') {
        balance = await this.web3.eth.getBalance(address)
      }

      currentAddress = address

      logger.debug(`sending tx from:`, { address, nonce, uuid, balance, gas, gasPrice })

      let txPromise = new Promise((res, rej) => {
        tx.send({ gas, gasPrice, chainId: this.networkId, nonce, from: address, type: 0 })
          .on('transactionHash', h => {
            release()

            txHash = h
            logger.debug('got tx hash:', { uuid, txHash })

            if (onTransactionHash) {
              onTransactionHash(h)
            }
          })
          .on('sent', payload => {
            logger.debug('tx sent:', { txHash, payload })
          })
          .on('receipt', r => {
            logger.debug('got tx receipt:', { uuid })

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
                gasPrice,
                address,
                balance
              })

              sendSlackAlert({ msg: 'admin account funds low', address, balance })
              await this.txManager.unlock(address)

              try {
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }, retry, logger))
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else if (isNonceError(e)) {
              let netNonce = parseInt(await this.web3.eth.getTransactionCount(address))

              logger.warn('sendTransaciton nonce failure retry', {
                errMessage: e.message,
                nonce,
                gas,
                gasPrice,
                address,
                newNonce: netNonce
              })

              await this.txManager.unlock(address, netNonce)

              try {
                await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }, retry, logger).then(res)
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else {
              fail()

              if (onError) {
                onError(e)
              }

              rej(e)
            }
          })
      })

      const response = await withTimeout(txPromise, FUSE_TX_TIMEOUT, 'fuse tx timeout')

      return response
    } catch (e) {
      await this.txManager.unlock(currentAddress)

      if (retry && e.message.includes('fuse tx timeout')) {
        logger.warn('sendTransaction timeout retrying:', { uuid, txHash })
        return this.sendTransaction(tx, txCallbacks, { gas, gasPrice }, false, logger)
      }

      logger.error('sendTransaction error:', e.message, e, { from: currentAddress, uuid })
      throw new Error(e)
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
   * @param {number} gasValues.gasPrice
   * @returns {Promise<Promise|Q.Promise<any>|Promise<*>|Promise<*>|Promise<*>|*>}
   */
  async sendNative(
    params: { from: string, to: string, value: string },
    txCallbacks: PromiEvents = {},
    { gas, gasPrice }: GasValues = { gas: undefined, gasPrice: undefined }
  ) {
    let currentAddress
    const { log } = this

    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

      gas = gas || defaultGas
      gasPrice = gasPrice || this.gasPrice

      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)

      log.debug('sendNative', { nonce, gas, gasPrice })
      currentAddress = address

      return new Promise((res, rej) => {
        this.web3.eth
          .sendTransaction({ gas, gasPrice, chainId: this.networkId, nonce, ...params, from: address })
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
                gasPrice,
                address,
                newNonce: netNonce
              })

              await this.txManager.unlock(address, netNonce)

              try {
                await this.sendNative(params, txCallbacks, { gas, gasPrice }).then(res)
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else {
              fail()

              if (onError) {
                onError(e)
              }

              log.error('sendNative failed', message, e)
              rej(e)
            }
          })
      })
    } catch (e) {
      await this.txManager.unlock(currentAddress)
      throw new Error(e)
    }
  }
}

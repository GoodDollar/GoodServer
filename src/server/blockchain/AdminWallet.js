// @flow
import Crypto from 'crypto'
import Web3 from 'web3'
import HDKey from 'hdkey'
import bip39 from 'bip39-light'
import { defer, from as fromPromise, timer } from 'rxjs'
import { retryWhen, mergeMap, throwError } from 'rxjs/operators'
import moment from 'moment'
import get from 'lodash/get'
import * as web3Utils from 'web3-utils'
import IdentityABI from '@gooddollar/goodcontracts/build/contracts/Identity.min.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.min.json'
import UBIABI from '@gooddollar/goodcontracts/build/contracts/FixedUBI.min.json'
import ProxyContractABI from '@gooddollar/goodcontracts/build/contracts/AdminWallet.min.json'
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'

import conf from '../server.config'
import logger from '../../imports/logger'
import { isNonceError, isFundsError } from '../utils/eth'
import requestTimeout from '../utils/timeout'
import { type TransactionReceipt } from './blockchain-types'

import { getManager } from '../utils/tx-manager'
import { sendSlackAlert } from '../../imports/slack'

const log = logger.child({ from: 'AdminWallet' })

const FUSE_TX_TIMEOUT = 12000 //should be confirmed after max 2 blocks (10sec)
const defaultGas = 200000
const defaultGasPrice = web3Utils.toWei('1', 'gwei')
const adminMinBalance = conf.adminMinBalance
/**
 * Exported as AdminWallet
 * Interface with blockchain contracts via web3 using HDWalletProvider
 */
export class Wallet {
  web3: Web3

  mainnetWeb3: Web3

  wallet: HDWallet

  accountsContract: Web3.eth.Contract

  tokenContract: Web3.eth.Contract

  identityContract: Web3.eth.Contract

  UBIContract: Web3.eth.Contract

  proxyContract: Web3.eth.Contract

  address: string

  networkId: number

  network: string

  mnemonic: string

  nonce: number

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic
    this.addresses = []
    this.filledAddresses = []
    this.mainnetAddresses = []
    this.wallets = {}
    this.numberOfAdminWalletAccounts = conf.privateKey ? 1 : conf.numberOfAdminWalletAccounts
    this.network = conf.network
    this.networkIdMainnet = conf.ethereumMainnet.network_id
    this.networkId = conf.ethereum.network_id
    this.maxMainnetGasPrice = conf.maxGasPrice * 1000000000 //maxGasPrice is in gwei, convert to wei
    this.ready = this.init()
  }

  getWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    let provider
    let web3Provider
    let transport = conf.ethereum.web3Transport
    switch (transport) {
      case 'WebSocket':
        provider = conf.ethereum.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      case 'HttpProvider':
        provider = conf.ethereum.httpWeb3Provider
        web3Provider = new Web3.providers.HttpProvider(provider)
        break

      default:
        provider = conf.ethereum.httpWeb3Provider
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
    }
    log.debug({ conf, web3Provider, provider })

    return web3Provider
  }

  addWallet(account) {
    this.web3.eth.accounts.wallet.add(account)
    this.web3.eth.defaultAccount = account.address
    this.mainnetWeb3.eth.accounts.wallet.add(account)
    this.mainnetWeb3.eth.defaultAccount = account.address
    this.addresses.push(account.address)
    this.wallets[account.address] = account
  }

  getMainnetWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    let provider
    let web3Provider
    let transport = conf.ethereumMainnet.web3Transport
    switch (transport) {
      case 'WebSocket':
        provider = conf.ethereumMainnet.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      default:
      case 'HttpProvider':
        provider = conf.ethereumMainnet.httpWeb3Provider
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
    }
    log.debug('mainnet', { web3Provider, provider })

    return web3Provider
  }

  async init() {
    log.debug('Initializing wallet:', { conf: conf.ethereum, mainnet: conf.ethereumMainnet })
    this.mainnetTxManager = getManager(conf.ethereumMainnet.network_id)
    this.txManager = getManager(conf.ethereum.network_id)
    this.web3 = new Web3(this.getWeb3TransportProvider(), null, {
      defaultBlock: 'latest',
      defaultGasPrice,
      transactionBlockTimeout: 5,
      transactionConfirmationBlocks: 1,
      transactionPollingTimeout: 20
    })

    this.mainnetWeb3 = new Web3(this.getMainnetWeb3TransportProvider(), null, {
      defaultBlock: 'latest',
      transactionBlockTimeout: 5,
      transactionConfirmationBlocks: 1
    })

    if (conf.privateKey) {
      let account = this.web3.eth.accounts.privateKeyToAccount(conf.privateKey)
      this.web3.eth.accounts.wallet.add(account)
      this.web3.eth.defaultAccount = account.address
      this.mainnetWeb3.eth.accounts.wallet.add(account)
      this.mainnetWeb3.eth.defaultAccount = account.address

      this.address = account.address
      this.addWallet(account)
      log.info('Initialized by private key:', { address: account.address })
    } else if (this.mnemonic) {
      let root = HDKey.fromMasterSeed(bip39.mnemonicToSeed(this.mnemonic, conf.adminWalletPassword))
      for (let i = 0; i < this.numberOfAdminWalletAccounts; i++) {
        const path = "m/44'/60'/0'/0/" + i
        let addrNode = root.derive(path)
        let account = this.web3.eth.accounts.privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))
        this.addWallet(account)
      }
      log.info('Initialized by mnemonic:', { address: this.addresses })
    }

    const adminWalletAddress = get(ContractsAddress, `${this.network}.AdminWallet`)
    this.proxyContract = new this.web3.eth.Contract(ProxyContractABI.abi, adminWalletAddress)

    const adminWalletContractBalance = await this.web3.eth.getBalance(adminWalletAddress)
    log.info(`AdminWallet contract balance`, { adminWalletContractBalance, adminWalletAddress })
    if (web3Utils.fromWei(adminWalletContractBalance, 'gwei') < adminMinBalance * this.addresses.length) {
      log.error('AdminWallet contract low funds')
      sendSlackAlert({ msg: 'AdminWallet contract low funds', adminWalletAddress, adminWalletContractBalance })
      if (conf.env !== 'test' && conf.env !== 'development') process.exit(-1)
    }

    this.txManager.getTransactionCount = this.web3.eth.getTransactionCount
    this.mainnetTxManager.getTransactionCount = this.mainnetWeb3.eth.getTransactionCount
    await this.txManager.createListIfNotExists(this.addresses)
    await this.mainnetTxManager.createListIfNotExists(this.mainnetAddresses)

    if (conf.topAdminsOnStartup) {
      await this.topAdmins().catch(e => {
        log.warn('Top admins failed', { e, errMessage: e.message })
      })
    }

    for (let addr of this.addresses) {
      const balance = await this.web3.eth.getBalance(addr)
      const mainnetBalance = await this.mainnetWeb3.eth.getBalance(addr)

      const isAdminWallet = await this.isVerifiedAdmin(addr)
      if (isAdminWallet && web3Utils.fromWei(balance, 'gwei') > adminMinBalance) {
        log.info(`admin wallet ${addr} balance ${balance}`)
        this.filledAddresses.push(addr)
      } else log.warn('Failed adding admin wallet', { addr, mainnetBalance, balance, isAdminWallet, adminMinBalance })
      if (web3Utils.fromWei(mainnetBalance, 'gwei') > adminMinBalance) {
        log.info(`admin wallet ${addr} mainnet balance ${mainnetBalance}`)
        this.mainnetAddresses.push(addr)
      } else log.warn('Failed adding mainnet admin wallet', { addr, mainnetBalance, adminMinBalance })
    }
    if (this.filledAddresses.length === 0) {
      log.error('no admin wallet with funds')
      sendSlackAlert({
        msg: 'critical: no fuse admin wallet with funds'
      })
      if (conf.env !== 'test' && conf.env !== 'development') process.exit(-1)
    }
    if (this.mainnetAddresses.length === 0) {
      sendSlackAlert({
        msg: 'critical: no mainnet admin wallet with funds'
      })
      log.error('no admin wallet with funds for mainnet')
      if (conf.env !== 'test') process.exit(-1)
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
    this.UBIContract = new this.web3.eth.Contract(UBIABI.abi, get(ContractsAddress, `${this.network}.UBI`), {
      from: this.address
    })

    try {
      let gdbalance = await this.tokenContract.methods.balanceOf(this.address).call()
      let nativebalance = await this.web3.eth.getBalance(this.address)
      this.nonce = parseInt(await this.web3.eth.getTransactionCount(this.address))
      log.debug('AdminWallet Ready:', {
        activeWallets: this.filledAddresses.length,
        activeMainnetWallets: this.mainnetAddresses.length,
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

      if (conf.env !== 'test' && conf.env !== 'development') process.exit(-1)
    }
    return true
  }

  /**
   * top admin wallet accounts
   * @param {object} event callbacks
   * @returns {Promise<String>}
   */
  async topAdmins(): Promise<any> {
    try {
      const { nonce, release, fail, address } = await this.txManager.lock(this.addresses[0])
      try {
        log.debug('topAdmins sending tx', { address, nonce })
        await this.proxyContract.methods.topAdmins(0).send({ gas: '500000', from: address, nonce })
        log.debug('topAdmins success')
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
   * charge bonuses for user via `bonus` contract
   * @param {string} address
   * @param {string} amountInWei
   * @param {object} event callbacks
   * @returns {Promise<String>}
   */
  async redeemBonuses(address: string, amountInWei: string, { onReceipt, onTransactionHash, onError }): Promise<any> {
    return this.sendTransaction(this.proxyContract.methods.awardUser(address, amountInWei), {
      onTransactionHash,
      onReceipt,
      onError
    })
  }

  /**
   * whitelist an user in the `Identity` contract
   * @param {string} address
   * @param {string} did
   * @returns {Promise<TransactionReceipt>}
   */
  async whitelistUser(address: string, did: string): Promise<TransactionReceipt | boolean> {
    const isVerified = await this.isVerified(address)

    if (isVerified) {
      return { status: true }
    }
    let txHash
    try {
      const lastAuth = await this.identityContract.methods
        .lastAuthenticated(address)
        .call()
        .then(_ => _.toNumber())

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

      log.error('Error whitelistUser', message, exception, { txHash, address, did })
      throw exception
    }
  }

  async authenticateUser(address: string): Promise<TransactionReceipt> {
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
      const transaction = await this.proxyContract.methods.genericCall(this.identityContract.address, encodedCall, 0)
      const tx = await this.sendTransaction(transaction)
      log.info('authenticated user', { address, tx })
      return tx
    } catch (exception) {
      const { message } = exception

      log.error('Error authenticateUser', message, exception, { address })
      throw exception
    }
  }
  /**
   * blacklist an user in the `Identity` contract
   * @param {string} address
   * @returns {Promise<TransactionReceipt>}
   */
  async blacklistUser(address: string): Promise<TransactionReceipt> {
    const tx: TransactionReceipt = await this.sendTransaction(
      this.identityContract.methods.addBlacklisted(address)
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
    const tx: boolean = await this.identityContract.methods
      .isWhitelisted(address)
      .call()
      .catch(e => {
        log.error('Error isVerified', e.message, e)
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
    const tx: boolean = await this.proxyContract.methods
      .isAdmin(address)
      .call()
      .catch(e => {
        log.error('Error isAdmin', e.message, e)
        throw e
      })
    return tx
  }

  retryTimeout(asyncFnTx, timeout = 10000, retries = 1, interval = 0) {
    return defer(() => fromPromise(Promise.race([asyncFnTx(), requestTimeout(timeout, 'Adminwallet tx timeout')])))
      .pipe(
        retryWhen(attempts =>
          attempts.pipe(
            mergeMap((attempt, index) => {
              const retryAttempt = index + 1

              if (retryAttempt > retries) {
                return throwError(attempt)
              }

              return timer(interval || 0)
            })
          )
        )
      )
      .toPromise()
  }
  /**
   * top wallet if needed
   * @param {string} address
   * @param {moment.Moment} lastTopping
   * @param {boolean} force
   * @returns {PromiEvent<TransactionReceipt>}
   */
  async topWallet(address: string, force: boolean = false): PromiEvent<TransactionReceipt> {
    let userBalance = await this.web3.eth.getBalance(address)
    let maxTopWei = parseInt(web3Utils.toWei('1000000', 'gwei'))
    let toTop = maxTopWei - userBalance
    log.debug('TopWallet:', { address, userBalance, toTop })
    if (toTop <= 0 || toTop / maxTopWei < 0.75) {
      log.debug("User doesn't need topping", { address })
      return { status: 1 }
    }

    let txHash
    try {
      const onTransactionHash = hash => {
        log.debug('Topwallet got txhash:', { hash, address })
        txHash = hash
      }

      const txPromise = this.sendTransaction(this.proxyContract.methods.topWallet(address), { onTransactionHash })
      let res = await txPromise
      log.debug('Topwallet result:', { txHash, address, res })
      return res
    } catch (e) {
      log.error('Error topWallet', e.message, e, { txHash, address, force })
      throw e
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
    return this.getAddressBalance(this.address)
      .then(b => web3Utils.fromWei(b))
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
    retry = true
  ) {
    let currentAddress, txHash
    const uuid = Crypto.randomBytes(5).toString('base64')
    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks
      gas =
        gas ||
        (await tx
          .estimateGas()
          .then(gas => gas + 200000) //buffer for proxy contract, reimburseGas?
          .catch(e => {
            log.error('Failed to estimate gas for tx', e.message, e)
            return defaultGas
          }))

      // adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) gas = defaultGas
      gasPrice = gasPrice || defaultGasPrice

      log.debug('getting tx lock:', { uuid })
      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)
      log.debug('got tx lock:', { uuid, address })

      let balance = NaN
      if (conf.env === 'development') {
        balance = await this.web3.eth.getBalance(address)
      }
      currentAddress = address
      log.debug(`sending tx from: ${address} | nonce: ${nonce}`, { uuid, balance, gas, gasPrice })
      let txPromise = new Promise((res, rej) => {
        tx.send({ gas, gasPrice, chainId: this.networkId, nonce, from: address })
          .on('transactionHash', h => {
            release()
            txHash = h
            log.debug('got tx hash:', { uuid, txHash })
            onTransactionHash && onTransactionHash(h)
          })
          .on('receipt', r => {
            log.debug('got tx receipt:', { uuid })
            onReceipt && onReceipt(r)
            res(r)
          })
          .on('confirmation', c => onConfirmation && onConfirmation(c))
          .on('error', async e => {
            log.error('sendTransaction error:', e.message, e, { from: address, uuid })
            if (isFundsError(e)) {
              balance = await this.mainnetWeb3.eth.getBalance(address)
              log.warn('sendTransaciton funds issue retry', {
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
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else if (isNonceError(e)) {
              let netNonce = parseInt(await this.web3.eth.getTransactionCount(address))
              log.warn('sendTransaciton nonce failure retry', {
                errMessage: e.message,
                nonce,
                gas,
                gasPrice,
                address,
                newNonce: netNonce
              })
              await this.txManager.unlock(address, netNonce)
              try {
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else {
              fail()
              onError && onError(e)
              rej(e)
            }
          })
      })

      const res = await Promise.race([txPromise, requestTimeout(FUSE_TX_TIMEOUT, 'fuse tx timeout')])
      return res
    } catch (e) {
      log.warn('sendTransaction failed:', e.message, { uuid, txHash, retry })
      await this.txManager.unlock(currentAddress)
      if (retry && e.message.contains('fuse tx timeout')) {
        log.warn('sendTransaction failed retrying:', { uuid, txHash })
        return this.sendTransaction(tx, txCallbacks, { gas, gasPrice }, false)
      }
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
    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks
      gas = gas || defaultGas
      gasPrice = gasPrice || defaultGasPrice

      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)
      log.debug('sendNative', { nonce, gas, gasPrice })
      currentAddress = address

      return new Promise((res, rej) => {
        this.web3.eth
          .sendTransaction({ gas, gasPrice, chainId: this.networkId, nonce, ...params, from: address })
          .on('transactionHash', h => {
            onTransactionHash && onTransactionHash(h)
            release()
          })
          .on('receipt', r => {
            onReceipt && onReceipt(r)
            res(r)
          })
          .on('confirmation', c => {
            onConfirmation && onConfirmation(c)
          })
          .on('error', async e => {
            const { message } = e

            log.error('sendNative failed', message, e)

            if (isNonceError(e)) {
              let netNonce = parseInt(await this.web3.eth.getTransactionCount(address))
              log.error('sendNative nonce failure retry', message, e, {
                params,
                nonce,
                gas,
                gasPrice,
                address,
                newNonce: netNonce
              })
              await this.txManager.unlock(address, netNonce)
              try {
                res(await this.sendNative(params, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else {
              fail()
              onError && onError(e)
              rej(e)
            }
          })
      })
    } catch (e) {
      await this.txManager.unlock(currentAddress)
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
  async sendTransactionMainnet(
    tx: any,
    txCallbacks: PromiEvents = {},
    { gas, gasPrice }: GasValues = { gas: undefined, gasPrice: undefined },
    forceAddress: string
  ) {
    let currentAddress
    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks
      gas =
        gas ||
        (await tx
          .estimateGas()
          .then(gas => gas + 200000) //buffer for proxy contract, reimburseGas?, and low gas unexpected failures
          .catch(e => {
            log.error('Failed to estimate gas for tx mainnet', e.message, e)
            return defaultGas
          }))

      //adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) gas = defaultGas
      gasPrice = gasPrice || Math.min(await this.mainnetWeb3.eth.getGasPrice(), this.maxMainnetGasPrice)

      const uuid = Crypto.randomBytes(5).toString('base64')
      log.debug('getting tx lock mainnet:', { uuid })
      const { nonce, release, fail, address } = await this.mainnetTxManager.lock(forceAddress || this.mainnetAddresses)
      log.debug('got tx lock mainnet:', { uuid, address })

      let balance = NaN
      if (conf.env === 'development') {
        balance = await this.mainnetWeb3.eth.getBalance(address)
      }
      currentAddress = address
      log.debug(`sending  tx mainnet from: ${address} | nonce: ${nonce}`, {
        network: this.networkIdMainNet,
        uuid,
        balance,
        gas,
        gasPrice
      })
      return new Promise((res, rej) => {
        tx.send({ gas, gasPrice, chainId: this.networkIdMainNet, nonce, from: address })
          .on('transactionHash', h => {
            release()
            log.debug('got tx hash mainnet:', { uuid })
            onTransactionHash && onTransactionHash(h)
          })
          .on('receipt', r => {
            log.debug('got tx receipt mainnet:', { uuid })
            onReceipt && onReceipt(r)
            res(r)
          })
          .on('confirmation', c => onConfirmation && onConfirmation(c))
          .on('error', async exception => {
            const { message } = exception

            log.error('sendTransaction error mainnet:', message, exception, { from: address, uuid })
            if (isFundsError(exception)) {
              balance = await this.mainnetWeb3.eth.getBalance(address)
              log.warn('sendTransaciton funds issue retry mainnet', {
                errMessage: message,
                nonce,
                gas,
                gasPrice,
                address,
                balance
              })
              sendSlackAlert({ msg: 'admin account funds low mainnet', address, balance })
              await this.mainnetTxManager.unlock(address)
              try {
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.mainnetTxManager.unlock(address)
                rej(e)
              }
            } else if (isNonceError(exception)) {
              let netNonce = parseInt(await this.mainnetWeb3.eth.getTransactionCount(address))
              log.warn('sendTransaciton nonce failure retry mainnet', {
                errMessage: message,
                nonce,
                gas,
                gasPrice,
                address,
                newNonce: netNonce
              })
              await this.mainnetTxManager.unlock(address, netNonce)
              try {
                res(await this.sendTransactionMainnet(tx, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.mainnetTxManager.unlock(address)
                rej(e)
              }
            } else {
              fail()
              onError && onError(exception)
              rej(exception)
            }
          })
      })
    } catch (e) {
      await this.mainnetTxManager.unlock(currentAddress)
      throw new Error(e)
    }
  }
}

const AdminWallet = new Wallet(conf.mnemonic)
export default AdminWallet

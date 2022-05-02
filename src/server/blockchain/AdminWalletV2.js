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

const log = logger.child({ from: 'AdminWalletV2' })

const FUSE_TX_TIMEOUT = 25000 //should be confirmed after max 5 blocks (25sec)
const defaultGas = 200000
const defaultGasPrice = web3Utils.toWei('1', 'gwei')
const defaultRopstenGasPrice = web3Utils.toWei('5', 'gwei')

const adminMinBalance = conf.adminMinBalance

const getAuthHeader = rpc => {
  const url = new URL(rpc)
  if (url.password) {
    return [
      {
        name: 'Authorization',
        value: `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}`
      }
    ]
  }
  return []
}
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

  faucetContract: Web3.eth.Contract

  address: string

  networkId: number

  network: string

  mnemonic: string

  nonce: number

  mainnetAddresses = []

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic
    this.addresses = []
    this.filledAddresses = []
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
      default:
        provider = conf.ethereum.httpWeb3Provider
        const headers = getAuthHeader(provider)
        web3Provider = new Web3.providers.HttpProvider(provider, {
          timeout: FUSE_TX_TIMEOUT,
          headers
        })
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
        const headers = getAuthHeader(provider)
        web3Provider = new Web3.providers.HttpProvider(provider, { headers })
        break
    }
    log.debug('mainnet', { web3Provider, provider })

    return web3Provider
  }

  async init() {
    log.debug('Initializing wallet:', { conf: conf.ethereum, mainnet: conf.ethereumMainnet })
    this.mainnetTxManager = getManager(conf.ethereumMainnet.network_id)
    this.txManager = getManager(conf.ethereum.network_id)
    const web3Default = {
      defaultBlock: 'latest',
      defaultGasPrice,
      transactionBlockTimeout: 5,
      transactionConfirmationBlocks: 1,
      transactionPollingTimeout: 30
    }
    this.web3 = new Web3(this.getWeb3TransportProvider(), null, web3Default)
    assign(this.web3.eth, web3Default)

    this.mainnetWeb3 = new Web3(this.getMainnetWeb3TransportProvider(), null, web3Default)
    assign(this.mainnetWeb3.eth, web3Default)
    this.mainnetWeb3.eth.transactionPollingTimeout = 600 //slow ropsten

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
    this.proxyContract = new this.web3.eth.Contract(ProxyContractABI.abi, adminWalletAddress, { from: this.address })

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

    if (conf.env !== 'production') await this.mainnetTxManager.createListIfNotExists(this.mainnetAddresses)

    log.info('Initialized wallet queue manager')
    if (conf.topAdminsOnStartup) {
      await this.topAdmins(0, conf.numberOfAdminWalletAccounts).catch(e => {
        log.warn('Top admins failed', { e, errMessage: e.message })
      })
    }

    const ps = this.addresses.map(async addr => {
      const balance = await this.web3.eth.getBalance(addr)

      const isAdminWallet = await this.isVerifiedAdmin(addr)
      if (isAdminWallet && parseFloat(web3Utils.fromWei(balance, 'gwei')) > adminMinBalance) {
        log.info(`admin wallet ${addr} balance ${balance}`)
        this.filledAddresses.push(addr)
      }
      // else log.warn('Failed adding admin wallet', { addr, balance, isAdminWallet, adminMinBalance })

      if (conf.env !== 'production') {
        const mainnetBalance = await this.mainnetWeb3.eth.getBalance(addr)
        if (parseFloat(web3Utils.fromWei(mainnetBalance, 'gwei')) > adminMinBalance * 100) {
          log.info(`admin wallet ${addr} mainnet balance ${mainnetBalance}`)
          this.mainnetAddresses.push(addr)
        }
        // else log.warn('Failed adding mainnet admin wallet', { addr, mainnetBalance, adminMinBalance })
      }
    })

    await Promise.all(ps)
    log.info('Initialized adminwallet addresses')

    if (this.filledAddresses.length === 0) {
      log.error('no admin wallet with funds')
      sendSlackAlert({
        msg: 'critical: no fuse admin wallet with funds'
      })
      if (conf.env !== 'test' && conf.env !== 'development') process.exit(-1)
    }

    // if (this.mainnetAddresses.length === 0) {
    //   sendSlackAlert({
    //     msg: 'critical: no mainnet admin wallet with funds'
    //   })
    //   log.error('no admin wallet with funds for mainnet')
    //   if (conf.env !== 'test') process.exit(-1)
    // }

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
  async topAdmins(numAdmins: number): Promise<any> {
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

  /**
   * top wallet if needed
   * @param {string} address
   * @returns {PromiEvent<TransactionReceipt>}
   */
  async topWallet(address: string, logger = log): PromiEvent<TransactionReceipt> {
    let userBalance = await this.web3.eth.getBalance(address)
    let maxTopWei = parseInt(web3Utils.toWei('1000000', 'gwei'))
    let toTop = maxTopWei - userBalance
    logger.debug('TopWallet:', { address, userBalance, toTop })
    if (toTop <= 0 || toTop / maxTopWei < 0.75) {
      logger.debug("User doesn't need topping", { address })
      return { status: 1 }
    }

    const faucetRes = await this.topWalletFaucet(address, logger).catch(_ => false)
    if (faucetRes) return faucetRes

    let txHash = ''
    //simulate tx to detect revert
    const canTopOrError = await this.proxyContract.methods
      .topWallet(address)
      .call()
      .then(_ => true)
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

      const txPromise = this.sendTransaction(
        this.proxyContract.methods.topWallet(address),
        { onTransactionHash },
        { gas: 500000 },
        true,
        logger
      )
      let res = await txPromise
      logger.debug('Topwallet result:', { txHash, address, res })
      return res
    } catch (e) {
      logger.error('Error topWallet', e.message, e, { txHash, address })
      throw e
    }
  }

  async topWalletFaucet(address, logger = log) {
    try {
      const canTop = await this.faucetContract.methods.canTop(address).call()
      logger.debug('topWalletFaucet canTop result:', { address, canTop })

      if (canTop === false) {
        return false
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
      const onTransactionHash = hash => {
        logger.debug('topWalletFaucet got txhash:', { hash, address })
      }
      const txPromise = this.sendTransaction(transaction, { onTransactionHash }, { gas: 500000 }, true, logger)
      let res = await txPromise
      logger.debug('topWalletFaucet result:', { address, res })
      return res
    } catch (e) {
      logger.error('Error topWalletFaucet', e.message, e, { address })
      throw e
    }
  }
  async fishMulti(toFish: Array<string>, logger = log): Promise<TransactionReceipt> {
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
  async transferWalletGooDollars(to, value, logger = log): Promise<TransactionReceipt> {
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
    logger = log
  ) {
    let currentAddress, txHash
    const uuid = Crypto.randomBytes(5).toString('base64')
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
      if (gas > 8000000) gas = defaultGas
      gasPrice = gasPrice || defaultGasPrice

      logger.debug('getting tx lock:', { uuid })
      const { nonce, release, fail, address } = await this.txManager.lock(this.filledAddresses)
      logger.debug('got tx lock:', { uuid, address })

      let balance = NaN
      if (conf.env === 'development') {
        balance = await this.web3.eth.getBalance(address)
      }
      currentAddress = address
      logger.debug(`sending tx from:`, { address, nonce, uuid, balance, gas, gasPrice })
      let txPromise = new Promise((res, rej) => {
        tx.send({ gas, gasPrice, chainId: this.networkId, nonce, from: address })
          .on('transactionHash', h => {
            release()
            txHash = h
            logger.debug('got tx hash:', { uuid, txHash })
            onTransactionHash && onTransactionHash(h)
          })
          .on('sent', payload => {
            logger.debug('tx sent:', { txHash, payload })
          })
          .on('receipt', r => {
            logger.debug('got tx receipt:', { uuid })
            onReceipt && onReceipt(r)
            res(r)
          })
          .on('confirmation', c => onConfirmation && onConfirmation(c))
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
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }, retry, logger))
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
                res(await this.sendNative(params, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await this.txManager.unlock(address)
                rej(e)
              }
            } else {
              fail()
              onError && onError(e)
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
            log.warn('Failed to estimate gas for tx mainnet', e.message, e)
            return defaultGas
          }))

      //adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) gas = defaultGas
      // gasPrice = gasPrice || Math.min(await this.mainnetWeb3.eth.getGasPrice(), this.maxMainnetGasPrice)
      gasPrice = gasPrice || defaultRopstenGasPrice

      const uuid = Crypto.randomBytes(5).toString('base64')
      log.debug('getting tx lock mainnet:', { uuid, forceAddress })
      const { nonce, release, fail, address } = await this.mainnetTxManager.lock(forceAddress || this.mainnetAddresses)
      log.debug('got tx lock mainnet:', { uuid, address, forceAddress })

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
        tx.send({
          // type: '0x2',
          gas,
          gasPrice,
          // maxFeePerGas: gasPrice,
          // maxPriorityFeePerGas: web3Utils.toWei('1', 'gwei'),
          // chainId: this.networkIdMainNet,
          nonce,
          from: address
        })
          .on('transactionHash', h => {
            release()
            log.debug('got tx hash mainnet:', { txhash: h, uuid })
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

            if (isFundsError(exception)) {
              balance = await this.mainnetWeb3.eth.getBalance(address)
              log.warn('sendTransaciton funds issue retry mainnet', {
                errMessage: message,
                nonce,
                gas,
                gasPrice,
                address,
                balance,
                uuid
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
                newNonce: netNonce,
                uuid
              })
              await this.mainnetTxManager.unlock(address, netNonce)
              try {
                res(await this.sendTransactionMainnet(tx, txCallbacks, { gas, gasPrice }, forceAddress))
              } catch (e) {
                await this.mainnetTxManager.unlock(address)
                rej(e)
              }
            } else {
              fail()
              onError && onError(exception)
              log.error('sendTransaction error mainnet:', message, exception, { from: address, uuid })
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

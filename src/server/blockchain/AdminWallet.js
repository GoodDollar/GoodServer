// @flow
import Web3 from 'web3'
import type { HttpProvider, WebSocketProvider } from 'web3-providers'
import IdentityABI from '@gooddollar/goodcontracts/build/contracts/Identity.json'
import RedemptionABI from '@gooddollar/goodcontracts/build/contracts/RedemptionFunctional.json'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.json'
import ReserveABI from '@gooddollar/goodcontracts/build/contracts/GoodDollarReserve.json'
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'
import conf from '../server.config'
import logger from '../../imports/pino-logger'
import { isNonceError } from '../utils/eth'
import { type TransactionReceipt } from './blockchain-types'
import moment from 'moment'
import get from 'lodash/get'

import txManager from '../utils/tx-manager'
import * as web3Utils from 'web3-utils'
import WalletFactory from './wallet/WalletFactory'
import SoftwareWalletProvider from './wallet/SoftwareWalletProvider'

const log = logger.child({ from: 'AdminWallet' })

/**
 * Exported as AdminWallet
 * Interface with blockchain contracts via web3 using HDWalletProvider
 */
const defaultGas = 500000

export class Wallet {
  web3: Web3

  wallet: SoftwareWalletProvider

  accountsContract: Web3.eth.Contract

  tokenContract: Web3.eth.Contract

  identityContract: Web3.eth.Contract

  claimContract: Web3.eth.Contract

  reserveContract: Web3.eth.Contract

  address: string

  networkId: number

  mnemonic: string

  nonce: number

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic
    this.ready = this.init()
    this.filledAddresses = []
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
        provider = conf.ethereum.httpWeb3Provider + conf.infuraKey
        web3Provider = new Web3.providers.HttpProvider(provider)
        break

      default:
        provider = conf.ethereum.httpWeb3Provider + conf.infuraKey
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
    }
    log.debug({ conf, web3Provider, provider })

    return web3Provider
  }

  async init(): Promise<any> {
    log.debug('Initializing wallet:', { conf: conf.ethereum })
    try {
      this.ready = WalletFactory.create()
      this.wallet = await this.ready
      this.accounts = this.wallet.web3.eth.accounts.wallet
      this.wallet.web3.eth.defaultAccount = this.accounts[0]
      this.networkId = ContractsAddress[conf.network].networkId
      this.network = conf.network
      log.info(`networkId: ${this.networkId}`)
      this.gasPrice = web3Utils.toWei('1', 'gwei')
      this.wallet.web3.eth.defaultGasPrice = this.gasPrice
      this.wallet.web3.eth.defaultBlock = 'latest'
      this.wallet.web3.eth.defaultGas = 200000
      this.wallet.web3.eth.transactionBlockTimeout = 5
      this.wallet.web3.eth.transactionConfirmationBlocks = 1
      this.wallet.web3.eth.transactionPollingTimeout = 30
      this.address = this.wallet.mulWallet.addresses[0]
      this.identityContract = new this.wallet.web3.eth.Contract(
        IdentityABI.abi,
        get(ContractsAddress, `${this.network}.Identity`, IdentityABI.networks[this.networkId].address),
        {
          from: this.address,
          gas: defaultGas,
          gasPrice: web3Utils.toWei('1', 'gwei')
        }
      )
      this.claimContract = new this.wallet.web3.eth.Contract(
        RedemptionABI.abi,
        get(ContractsAddress, `${this.network}.RedemptionFunctional`, RedemptionABI.networks[this.networkId].address),
        {
          from: this.address,
          gas: defaultGas,
          gasPrice: web3Utils.toWei('1', 'gwei')
        }
      )
      this.tokenContract = new this.wallet.web3.eth.Contract(
        GoodDollarABI.abi,
        get(ContractsAddress, `${this.network}.GoodDollar`, GoodDollarABI.networks[this.networkId].address),
        {
          from: this.address,
          gas: defaultGas,
          gasPrice: web3Utils.toWei('1', 'gwei')
        }
      )
      this.reserveContract = new this.wallet.web3.eth.Contract(
        ReserveABI.abi,
        get(ContractsAddress, `${this.network}.GoodDollarReserve`, ReserveABI.networks[this.networkId].address),
        {
          from: this.address,
          gas: defaultGas,
          gasPrice: web3Utils.toWei('1', 'gwei')
        }
      )
      let gdbalance = await this.tokenContract.methods.balanceOf(this.address).call()
      let nativebalance = await this.wallet.web3.eth.getBalance(this.address)
      log.debug('AdminWallet Ready:', {
        account: this.address,
        gdbalance,
        nativebalance,
        network: this.networkId
      })

      txManager.getTransactionCount = this.wallet.web3.eth.getTransactionCount
      await txManager.createListIfNotExists(this.wallet.mulWallet.addresses)
      for (let addr of this.wallet.mulWallet.addresses) {
        const balance = await this.wallet.web3.eth.getBalance(addr)
        log.info(`admin wallet ${addr} balance ${balance}`)
        if (balance > web3Utils.toWei('1000000', 'gwei')) {
          this.filledAddresses.push(addr)
        }
      }
    } catch (e) {
      log.error('Failed initializing GoodWallet', e.message, e)
      throw e
    }
    return true
  }

  /**
   * whitelist an user in the `Identity` contract
   * @param {string} address
   * @param {string} did
   * @returns {Promise<TransactionReceipt>}
   */
  async whitelistUser(address: string, did: string): Promise<TransactionReceipt> {
    const tx: TransactionReceipt = await this.sendTransaction(
      this.identityContract.methods.whiteListUser(address, did)
    ).catch(e => {
      log.error('Error whitelistUser', { e }, e.message)
      throw e
    })
    log.info('Whitelisted user', { address, did, tx })
    return tx
  }

  /**
   * blacklist an user in the `Identity` contract
   * @param {string} address
   * @returns {Promise<TransactionReceipt>}
   */
  async blacklistUser(address: string): Promise<TransactionReceipt> {
    const tx: TransactionReceipt = await this.sendTransaction(
      this.identityContract.methods.blackListUser(address)
    ).catch(e => {
      log.error('Error blackListUser', { e }, e.message)
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
        log.error('Error isVerified', { e }, e.message)
        throw e
      })
    return tx
  }

  /**
   * top wallet if needed
   * @param {string} address
   * @param {moment.Moment} lastTopping
   * @param {boolean} force
   * @returns {PromiEvent<TransactionReceipt>}
   */
  async topWallet(
    address: string,
    lastTopping?: moment.Moment = moment().subtract(1, 'day'),
    force: boolean = false
  ): PromiEvent<TransactionReceipt> {
    let daysAgo = moment().diff(moment(lastTopping), 'days')
    if (conf.env !== 'development' && daysAgo < 1) throw new Error('Daily limit reached')
    try {
      let userBalance = await this.wallet.web3.eth.getBalance(address)
      let toTop = parseInt(web3Utils.toWei('1000000', 'gwei')) - userBalance
      log.debug('TopWallet:', { userBalance, toTop })
      if (force || toTop / 1000000 >= 0.75) {
        let res = await this.sendNative({
          from: this.address,
          to: address,
          value: toTop,
          gas: 100000,
          gasPrice: web3Utils.toWei('1', 'gwei')
        })
        log.debug('Topwallet result:', res)
        return res
      }
      throw new Error("User doesn't need topping")
    } catch (e) {
      log.error('Error topWallet', { e }, e.message)
      throw e
    }
  }

  async getAddressBalance(address: string): Promise<number> {
    return this.wallet.web3.eth.getBalance(address)
  }

  /**
   * get balance for admin wallet
   * @returns {Promise<number>}
   */
  async getBalance(): Promise<number> {
    return this.getAddressBalance(this.address)
      .then(b => web3Utils.fromWei(b))
      .catch(e => {
        log.error('Error getBalance', e)
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
    { gas, gasPrice }: GasValues = { gas: undefined, gasPrice: undefined }
  ) {
    let currentAddress
    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks
      gas = gas || (await tx.estimateGas())
      gasPrice = gasPrice || this.gasPrice

      const { nonce, release, fail, address } = await txManager.lock(this.filledAddresses)
      currentAddress = address
      log.debug(`sending tx from: ${address} | nonce: ${nonce}`)
      return new Promise((res, rej) => {
        tx.send({ gas, gasPrice, chainId: this.networkId, nonce, from: address })
          .on('transactionHash', h => {
            release()
            onTransactionHash && onTransactionHash(h)
          })
          .on('receipt', r => {
            onReceipt && onReceipt(r)
            res(r)
          })
          .on('confirmation', c => onConfirmation && onConfirmation(c))
          .on('error', async e => {
            if (isNonceError(e)) {
              let netNonce = parseInt(await this.wallet.web3.eth.getTransactionCount(address))
              await txManager.unlock(address, netNonce)
              try {
                res(await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await txManager.unlock(address)
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
      await txManager.unlock(currentAddress)
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
      gas = gas || 100000
      gasPrice = gasPrice || this.gasPrice

      const { nonce, release, fail, address } = await txManager.lock(this.filledAddresses)
      currentAddress = address

      return new Promise((res, rej) => {
        this.wallet.web3.eth
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
            if (isNonceError(e)) {
              let netNonce = parseInt(await this.wallet.web3.eth.getTransactionCount(address))
              await txManager.unlock(address, netNonce)
              try {
                res(await this.sendNative(params, txCallbacks, { gas, gasPrice }))
              } catch (e) {
                await txManager.unlock(address)
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
      await txManager.unlock(currentAddress)
      throw new Error(e)
    }
  }
}

const AdminWallet = new Wallet(conf.mnemonic)
export default AdminWallet

// @flow

import Crypto from 'crypto'
import Web3 from 'web3'
import { assign } from 'lodash'
import * as web3Utils from 'web3-utils'

import { Web3Wallet, web3Default, defaultGas, adminMinBalance } from './Web3Wallet'
import conf from '../server.config'
import { isNonceError, isFundsError } from '../utils/eth'
import { getManager } from '../utils/tx-manager'
import { HttpProviderFactory, WebsocketProvider } from './transport'

const defaultRopstenGasPrice = web3Utils.toWei('5', 'gwei')

class AdminWallet extends Web3Wallet {
  constructor(name, conf, options) {
    super(name, conf, options)

    this.networkIdMainnet = conf.ethereumMainnet.network_id
    this.maxMainnetGasPrice = conf.maxGasPrice * 1000000000 // maxGasPrice is in gwei, convert to wei
  }

  addWallet(account) {
    super.addWallet(account)
    this.addWalletAccount(this.mainnetWeb3, account)
  }

  getMainnetWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    let provider
    let web3Provider
    const { web3Transport, websocketWeb3Provider, httpWeb3Provider } = this.conf.ethereumMainnet
    const { log } = this

    switch (web3Transport) {
      case 'WebSocket':
        provider = websocketWeb3Provider
        web3Provider = new WebsocketProvider(provider)
        break

      default:
      case 'HttpProvider': {
        provider = httpWeb3Provider
        web3Provider = HttpProviderFactory.create(provider)
        break
      }
    }

    log.debug('mainnet', { web3Provider, provider })
    return web3Provider
  }

  async init() {
    const { log, conf } = this
    const { ethereumMainnet, env } = conf

    log.debug('Initializing wallet mainnet:', { mainnet: ethereumMainnet })

    const mainnetWeb3 = new Web3(this.getMainnetWeb3TransportProvider(), null, web3Default)
    const mainnetTxManager = getManager(ethereumMainnet.network_id)
    const { eth } = mainnetWeb3
    const mainnetAddresses = []

    assign(mainnetTxManager, { getTransactionCount: eth.getTransactionCount })
    assign(eth, web3Default, { transactionPollingTimeout: 600 }) // slow ropsten
    assign(this, { mainnetWeb3, mainnetTxManager, mainnetAddresses })

    await super.init()

    if (env !== 'production') {
      log.info('Initializing adminwallet mainnet addresses', { addresses: this.addresses })

      await Promise.all(
        this.addresses.map(async addr => {
          const mainnetBalance = await mainnetWeb3.eth.getBalance(addr)

          log.info(`try mainnnet address ${addr}:`, { mainnetBalance, adminMinBalance })

          if (parseFloat(web3Utils.fromWei(mainnetBalance, 'gwei')) > adminMinBalance * 100) {
            log.info(`admin wallet ${addr} mainnet balance ${mainnetBalance}`)
            mainnetAddresses.push(addr)
          }
        })
      )

      log.info('Initialized adminwallet mainnet addresses', { mainnetAddresses })
      await mainnetTxManager.createListIfNotExists(mainnetAddresses)
    }

    log.debug('AdminWallet mainnet Ready:', {
      activeMainnetWallets: mainnetAddresses.length
    })

    return true
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
    const { log } = this

    try {
      const { onTransactionHash, onReceipt, onConfirmation, onError } = txCallbacks

      gas =
        gas ||
        (await tx
          .estimateGas()
          .then(gas => gas + 200000) // buffer for proxy contract, reimburseGas?, and low gas unexpected failures
          .catch(e => {
            log.warn('Failed to estimate gas for tx mainnet', e.message, e)
            return defaultGas
          }))

      // adminwallet contract might give wrong gas estimates, so if its more than block gas limit reduce it to default
      if (gas > 8000000) {
        gas = defaultGas
      }

      gasPrice = gasPrice || defaultRopstenGasPrice

      const uuid = Crypto.randomBytes(5).toString('base64')

      log.debug('getting tx lock mainnet:', { uuid, forceAddress })

      const { nonce, release, fail, address } = await this.mainnetTxManager.lock(forceAddress || this.mainnetAddresses)

      log.debug('got tx lock mainnet:', { uuid, address, forceAddress })

      let balance = NaN

      if (this.conf.env === 'development') {
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
          gas,
          gasPrice,
          nonce,
          from: address
        })
          .on('transactionHash', h => {
            release()

            log.debug('got tx hash mainnet:', { txhash: h, uuid })

            if (onTransactionHash) {
              onTransactionHash(h)
            }
          })
          .on('receipt', r => {
            log.debug('got tx receipt mainnet:', { uuid })

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

              await this.mainnetTxManager.unlock(address)

              try {
                await this.sendTransaction(tx, txCallbacks, { gas, gasPrice }).then(res)
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
                await this.sendTransactionMainnet(tx, txCallbacks, { gas, gasPrice }, forceAddress).then(res)
              } catch (e) {
                await this.mainnetTxManager.unlock(address)
                rej(e)
              }
            } else {
              fail()

              if (onError) {
                onError(exception)
              }

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

// fuse defaults
const options = {
  maxFeePerGas: (15e9).toFixed(0),
  maxPriorityFeePerGas: (1e9).toFixed(0)
}

export default new AdminWallet('AdminWallet', conf, options)

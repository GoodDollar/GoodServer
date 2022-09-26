// @flow

import Web3 from 'web3'
import { assign } from 'lodash'

import { Web3Wallet, getAuthHeader, web3Default } from './Web3Wallet'
import conf from '../server.config'

const defaultRopstenGasPrice = web3Utils.toWei('5', 'gwei')

class AdminWallet extends Web3Wallet {
  constructor(name, conf, ethereum, network, initialGasPrice) {
    super(name, conf, ethereum, network, initialGasPrice)

    this.networkIdMainnet = conf.ethereumMainnet.network_id
    this.maxMainnetGasPrice = conf.maxGasPrice * 1000000000 // maxGasPrice is in gwei, convert to wei
  }

  addWallet(account) {
    const { eth } = this.mainnetWeb3
    const { address } = account

    super.addWallet(account)

    eth.accounts.wallet.add(account)
    eth.defaultAccount = address
  }

  getMainnetWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    let provider
    let web3Provider
    let transport = this.conf.ethereumMainnet.web3Transport

    switch (transport) {
      case 'WebSocket':
        provider = this.conf.ethereumMainnet.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      default:
      case 'HttpProvider':
        provider = this.conf.ethereumMainnet.httpWeb3Provider
        const headers = getAuthHeader(provider)
        web3Provider = new Web3.providers.HttpProvider(provider, { headers })
        break
    }

    log.debug('mainnet', { web3Provider, provider })
    return web3Provider
  }

  async init() {
    const { ethereumMainnet, env } = this.conf

    await super.init()

    log.debug('Initializing wallet:', { mainnet: ethereumMainnet })

    const mainnetWeb3 = new Web3(this.getMainnetWeb3TransportProvider(), null, web3Default)
    const mainnetTxManager = getManager(ethereumMainnet.network_id)
    const { eth } = mainnetWeb3

    assign(mainnetTxManager, { getTransactionCount: eth.getTransactionCount })
    assign(eth, web3Default, { transactionPollingTimeout: 600 }) // slow ropsten
    assign(this, { mainnetWeb3, mainnetTxManager })

    if (env !== 'production') {
      await mainnetTxManager.createListIfNotExists(this.mainnetAddresses)
    }

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

export default new AdminWallet('AdminWallet', conf)

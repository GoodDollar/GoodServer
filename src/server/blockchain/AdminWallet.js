// @flow

import Crypto from 'crypto'
import { assign } from 'lodash'
import { formatUnits, parseGwei } from 'viem'

import { Web3Wallet, defaultGas, adminMinBalance } from './Web3Wallet'
import conf from '../server.config'
import { isNonceError, isFundsError } from '../utils/eth'
import { getManager } from '../utils/tx-manager'

const defaultRopstenGasPrice = parseGwei('5')

class AdminWallet extends Web3Wallet {
  constructor(name, conf, options, useKMS = false) {
    super(name, conf, options, useKMS)

    this.networkIdMainnet = conf.ethereumMainnet.network_id
    this.maxMainnetGasPrice = conf.maxGasPrice * 1000000000 // maxGasPrice is in gwei, convert to wei
  }

  async init() {
    const { log, conf } = this
    const { ethereumMainnet, env } = conf

    log.debug('Initializing wallet mainnet:', { mainnet: ethereumMainnet })

    const { publicClient: mainnetPublicClient, walletClient: mainnetWalletClient } =
      await this.createClients(ethereumMainnet)
    const mainnetTxManager = getManager(ethereumMainnet.network_id)
    const mainnetAddresses = []

    mainnetTxManager.getTransactionCount = address => mainnetPublicClient.getTransactionCount({ address })
    assign(this, { mainnetPublicClient, mainnetWalletClient, mainnetTxManager, mainnetAddresses })

    const ready = await super.init()
    if (!ready) return false

    if (env !== 'production' && this.mainnetPublicClient) {
      log.info('Initializing adminwallet mainnet addresses', { addresses: this.addresses })

      await Promise.all(
        this.addresses.map(async addr => {
          const mainnetBalance = await this.mainnetPublicClient.getBalance({ address: addr })

          log.info(`try mainnnet address ${addr}:`, { mainnetBalance, adminMinBalance })

          if (parseFloat(formatUnits(mainnetBalance, 9)) > adminMinBalance * 100) {
            log.info(`admin wallet ${addr} mainnet balance ${mainnetBalance}`)
            this.mainnetAddresses.push(addr)
          }
        })
      )

      log.info('Initialized adminwallet mainnet addresses', { mainnetAddresses: this.mainnetAddresses })
      await this.mainnetTxManager.createListIfNotExists(this.mainnetAddresses)
    }

    log.debug('AdminWallet mainnet Ready:', {
      activeMainnetWallets: this.mainnetAddresses ? this.mainnetAddresses.length : 0
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
      gas =
        gas ||
        (await this.mainnetPublicClient
          .estimateGas({ ...tx, account: forceAddress || this.address })
          .then(gas => Number(gas) + 200000)
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

      const { nonce, release, address } = await this.mainnetTxManager.lock(forceAddress || this.mainnetAddresses)

      log.debug('got tx lock mainnet:', { uuid, address, forceAddress })

      let balance = NaN

      if (this.conf.env === 'development') {
        balance = await this.mainnetPublicClient.getBalance({ address })
      }

      currentAddress = address

      log.debug(`sending  tx mainnet from: ${address} | nonce: ${nonce}`, {
        network: this.networkIdMainNet,
        uuid,
        balance,
        gas,
        gasPrice,
        isKMS: this.isKMSWallet(address)
      })

      return await this._sendViemTransaction(
        tx,
        address,
        { gas, gasPrice, nonce },
        txCallbacks,
        { release, timeout: 600000 },
        { publicClient: this.mainnetPublicClient, walletClient: this.mainnetWalletClient }
      )
    } catch (e) {
      if (currentAddress) {
        const netNonce = await this.mainnetPublicClient.getTransactionCount({ address: currentAddress })
        await this.mainnetTxManager.unlock(currentAddress, netNonce)
        if (isNonceError(e) || isFundsError(e)) {
          return this.sendTransactionMainnet(tx, txCallbacks, { gas, gasPrice }, forceAddress)
        }
      }
      throw e
    }
  }
}

// fuse defaults
const options = {
  maxFeePerGas: (25e9).toFixed(0),
  maxPriorityFeePerGas: (1e9).toFixed(0)
}

export const createAdminWallet = (useKMS = conf.kmsEnabled) => {
  return new AdminWallet('AdminWallet', conf, options, useKMS)
}

export default createAdminWallet()

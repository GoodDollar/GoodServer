// @flow

import { assign } from 'lodash'
import { formatUnits } from 'viem'

import { Web3Wallet, adminMinBalance } from './Web3Wallet'
import conf from '../server.config'
import { getManager } from '../utils/tx-manager'

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

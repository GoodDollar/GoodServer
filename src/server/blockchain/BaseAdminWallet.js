import FaucetABI from '@gooddollar/goodprotocol/artifacts/contracts/fuseFaucet/FuseFaucetV2.sol/FuseFaucetV2.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import { get } from 'lodash'
import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { base, env } = conf
const options = {
  ethereum: base,
  network: `${env}-base`,
  maxFeePerGas: (1e7).toFixed(0),
  maxPriorityFeePerGas: (1e4).toFixed(0),
  fetchGasPrice: false,
  faucetTxCost: 500000
}

export class BaseAdminWallet extends Web3Wallet {
  constructor(opts = {}, celoWallet) {
    super('BaseAdminWallet', conf, { ...options, ...opts })
    this.celoWallet = celoWallet
  }

  async initialize() {
    const ready = super.initialize()
    return ready.then(r => {
      this.faucetContract = new this.web3.eth.Contract(
        FaucetABI.abi,
        get(ContractsAddress, `${this.network}.SuperfluidFaucet`),
        {
          from: this.address
        }
      )
      return r
    })
  }

  async topWallet(address, customLogger = null) {
    const logger = customLogger || this.log
    if (await this.celoWallet.isVerified(address)) {
      return this.topWalletFaucet(address, logger).catch(() => false)
    }
    logger.info('BaseAdminWallet topWalletFailed: address not whitelisted on celo', { address })
    return false
  }

  async whitelistUser() {
    return true
  }

  async isVerified() {
    return true
  }
  async removeWhitelisted() {
    return true
  }
  async registerRedtent() {
    return true
  }
}

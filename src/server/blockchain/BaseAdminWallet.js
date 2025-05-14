import { default as SuperfluidFaucetABI } from '@gooddollar/goodprotocol/artifacts/contracts/fuseFaucet/SuperfluidFacuet.sol/SuperfluidFaucet.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import { get } from 'lodash'
import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { base, env } = conf
const options = {
  ethereum: base,
  network: `${env}-base`,
  maxFeePerGas: undefined, // will force use of estimatefees
  maxPriorityFeePerGas: undefined, // will force use of estimate fees
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
      if (r) {
        this.faucetContract = new this.web3.eth.Contract(
          SuperfluidFaucetABI.abi,
          get(ContractsAddress, `${this.network}.SuperfluidFaucet`),
          {
            from: this.address
          }
        )
      }
      return r
    })
  }

  async topWallet(address, customLogger = null) {
    const logger = customLogger || this.log
    if (!this.faucetContract) return true
    if (await this.celoWallet.isVerified(address)) {
      const { baseFeePerGas = 1e7 } = await this.web3.eth.getBlock('latest')
      const canTop = await this.faucetContract.methods
        .canTop(address, baseFeePerGas)
        .call()
        .catch(() => true)
      if (canTop) {
        return this.topWalletFaucet(address, logger).catch(() => false)
      }
      return false
    }
    logger.info('BaseAdminWallet topWalletFailed: address not whitelisted on celo', { address })
    return false
  }

  async whitelistUser() {
    return true
  }

  async isVerified() {
    return false
  }
  async removeWhitelisted() {
    return true
  }
  async registerRedtent() {
    return true
  }
}

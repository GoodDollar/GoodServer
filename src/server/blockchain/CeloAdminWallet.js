import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'

import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env, celoFallbackToProd } = conf
let network = `${env}-celo`
const defaultCeloGasPrice = (0.2 * 1e9).toFixed(0)

// there's no "development/staging-celo" in deployment.json
// added fallback to PROD settings, enables by the env flag
if (!ContractsAddress.hasOwnProperty(network) && celoFallbackToProd) {
  network = 'production-celo'
}

export default new Web3Wallet('CeloAdminWallet', conf, celo, network, defaultCeloGasPrice)

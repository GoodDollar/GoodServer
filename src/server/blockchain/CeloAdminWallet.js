import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
const options = {
  ethereum: celo,
  network: `${env}-celo`,
  initialGasPrice: (0.25 * 1e9).toFixed(0),
  fetchGasPrice: true
}

export default new Web3Wallet('CeloAdminWallet', conf, options)

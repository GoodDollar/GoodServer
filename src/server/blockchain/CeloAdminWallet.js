import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
const options = {
  ethereum: celo,
  network: `${env}-celo`,
  initialGasPrice: (5 * 1e9).toFixed(0),
  fetchGasPrice: false
}

export default new Web3Wallet('CeloAdminWallet', conf, options)

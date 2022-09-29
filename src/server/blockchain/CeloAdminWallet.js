import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
const options = {
  ethereum: celo,
  network: `${env}-celo`,
  initialGasPrice: (0.2 * 1e9).toFixed(0),
  lazyInitialize: env === 'test' // disable auto init as Celo is disabled during tests
}

export default new Web3Wallet('CeloAdminWallet', conf, options)

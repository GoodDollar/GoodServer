import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
const options = {
  ethereum: celo,
  network: `${env}-celo`,
  maxFeePerGas: (25e9).toFixed(0),
  maxPriorityFeePerGas: (0e9).toFixed(0),
  fetchGasPrice: false,
  faucetTxCost: 250000
}

export function CeloAdminWallet(opts = {}) {
  return new Web3Wallet('CeloAdminWallet', conf, { ...options, ...opts })
}

import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { xdc, env } = conf
const options = {
  ethereum: xdc,
  network: `${env}-xdc`,
  gasPrice: 12.5e9,
  fetchGasPrice: false,
  faucetTxCost: 250000
}

export function XdcAdminWallet(opts = {}) {
  return new Web3Wallet('XdcAdminWallet', conf, { ...options, ...opts })
}

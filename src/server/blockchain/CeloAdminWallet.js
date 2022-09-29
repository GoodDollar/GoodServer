import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
// TODO: add dapptest-celo to the contracts, now development network will be used
// const network = `${env === 'test' ? 'dapp' + env : env}-celo`
const network = `${env === 'test' ? 'development' : env}-celo`
const defaultCeloGasPrice = (0.2 * 1e9).toFixed(0)

export default new Web3Wallet('CeloAdminWallet', conf, celo, network, defaultCeloGasPrice)

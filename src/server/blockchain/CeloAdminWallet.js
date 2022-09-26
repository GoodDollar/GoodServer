import { Web3Wallet } from './Web3Wallet'
import conf from '../server.config'

const { celo, env } = conf
const network = `${env}-celo`

export default new Web3Wallet('CeloAdminWallet', conf, celo, network)

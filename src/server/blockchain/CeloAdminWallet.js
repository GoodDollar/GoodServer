import { Wallet } from './AdminWalletV2'
import conf from '../server.config'

const walletConfig = { ...conf, ethereum: conf.celo, network: conf.env + '-celo' }
export default new Wallet(walletConfig)

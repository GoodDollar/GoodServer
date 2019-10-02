// @flow
import Web3 from 'web3'
import type { HttpProvider, WebSocketProvider } from 'web3-providers'
import conf from '../../server.config'
import logger from '../../../imports/pino-logger'
import MultipleAddressWallet from './MultipleAddressWallet'

const log = logger.child({ from: 'SoftwareWalletProvider' })

class SoftwareWalletProvider {
  ready: Promise<Web3>

  defaults = {
    defaultBlock: 'latest',
    defaultGas: 140000,
    defaultGasPrice: 1000000,
    transactionBlockTimeout: 2,
    transactionConfirmationBlocks: 1,
    transactionPollingTimeout: 30
  }

  constructor() {
    this.ready = this.initSoftwareWallet()
  }

  async initSoftwareWallet(): Promise<Web3> {
    let provider = this.getWeb3TransportProvider()
    log.info('wallet config:', this.conf, provider)

    //let web3 = new Web3(new WebsocketProvider("wss://ropsten.infura.io/ws"))

    //we start from address 1, since from address 0 pubkey all public keys can  be generated
    //and we want privacy
    this.mulWallet = new MultipleAddressWallet(conf.mnemonic, conf.numberOfAdminWalletAccounts)
    this.web3 = new Web3(provider, null, this.defaults)
    for (const addr of this.mulWallet.addresses) {
      let pk = '0x' + this.mulWallet.wallets[addr].getPrivateKey().toString('hex')
      let wallet = this.web3.eth.accounts.privateKeyToAccount(pk)
      log.info(`address ${addr} pk=${pk}`)
      this.web3.eth.accounts.wallet.add(wallet)
    }
    this.web3.eth.defaultAccount = this.mulWallet.addresses[0]
    return this
  }

  getWeb3TransportProvider(): HttpProvider | WebSocketProvider {
    let provider
    let web3Provider
    console.log('###########', conf.ethereum)
    console.log('###########conf.ethereum.httpWeb3provider', conf.ethereum.httpWeb3Provider)
    switch (conf.ethereum.web3Transport) {
      case 'WebSocketProvider':
        provider = conf.ethereum.websocketWeb3Provider
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      case 'HttpProvider': {
        const infuraKey = conf.ethereum.httpWeb3Provider.indexOf('infura') === -1 ? '' : conf.infuraKey
        provider = conf.ethereum.httpWeb3Provider + infuraKey
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
      }
      default:
        provider = conf.ethereum.httpWeb3Provider + conf.infuraKey
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
    }

    return web3Provider
  }
}

export default SoftwareWalletProvider

// @flow
import Web3 from 'web3'
import SoftwareWalletProvider from './SoftwareWalletProvider'

export default class WalletFactory {
  static create(): Promise<Web3> {
    let provider: SoftwareWalletProvider = new SoftwareWalletProvider()
    return provider.ready
  }
}

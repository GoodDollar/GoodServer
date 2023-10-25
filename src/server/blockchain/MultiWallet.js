// @flow
import { assign, every, forOwn, isEmpty, isError, map, some } from 'lodash'
import AdminWallet from './AdminWallet'
import { CeloAdminWallet } from './CeloAdminWallet'
import conf from '../server.config'
import logger from '../../imports/logger'
import { DefenderRelayer } from './DefenderRelayer'
const multiLogger = logger.child({ from: 'MultiWallet' })

class MultiWallet {
  mainWallet = null
  otherWallets = []
  wallets = []
  walletsMap = {}
  defaultChainId = null
  signer: DefenderRelayer = null

  get ready() {
    return Promise.all(map(this.wallets, 'ready')).then(() => this.mainWallet.addresses)
  }

  constructor(walletsMap) {
    let mainWallet
    let defaultChainId
    this.signer = DefenderRelayer.getInstance()

    forOwn(walletsMap, (wallet, chainId) => {
      this.wallets.push(wallet)

      if (mainWallet) {
        this.otherWallets.push(wallet)
      } else {
        mainWallet = wallet
        defaultChainId = chainId
      }
    })

    multiLogger.debug('MultiWallet constructor:', {
      wallets: Object.keys(walletsMap),
      mainWallet: mainWallet.networkId,
      otherWallets: this.otherWallets.map(_ => _.networkId)
    })

    assign(this, { walletsMap, mainWallet, defaultChainId })
  }

  signMessage(message: string) {
    return this.signer.signMessage(message)
  }

  async topWallet(account, chainId = null, log = multiLogger) {
    const runTx = wallet => wallet.topWallet(account, log)

    if (chainId === 'all') {
      const results = await Promise.all(this.wallets.map(wallet => runTx(wallet).catch(e => e)))
      const error = results.find(isError)

      if (error) {
        throw error
      }

      return results
    }

    const { walletsMap, defaultChainId } = this
    const chain = chainId && chainId in walletsMap ? chainId : defaultChainId

    return runTx(walletsMap[chain])
  }

  async whitelistUser(account, did, chainId = null, log = multiLogger) {
    return Promise.all(this.wallets.map(wallet => wallet.whitelistUser(account, did, chainId, 0, log)))
  }

  async removeWhitelisted(account) {
    return Promise.all(this.wallets.map(wallet => wallet.removeWhitelisted(account)))
  }

  async verifiedStatus(account) {
    return Promise.all(
      this.wallets.map(wallet => wallet.isVerified(account).then(status => ({ chainId: wallet.networkId, status })))
    )
  }

  async isVerified(account) {
    return this.mainWallet.isVerified(account)
  }

  async lastAuthenticated(account) {
    return this.mainWallet.getLastAuthenticated(account)
  }

  async syncWhitelist(account, log = multiLogger) {
    try {
      const isVerified = await Promise.all(this.wallets.map(wallet => wallet.isVerified(account)))

      log.debug('syncwhitelist isVerified:', { account, isVerified })

      if (isEmpty(isVerified) || every(isVerified) || !some(isVerified)) {
        return false
      }

      const mainWallet = this.wallets[isVerified.findIndex(_ => _)]

      const [did, lastAuthenticated] = await Promise.all([
        mainWallet.getDID(account).catch(() => account),
        mainWallet.getLastAuthenticated(account).catch(() => 0)
      ])
      const chainId = mainWallet.networkId

      log.debug('syncwhitelist did:', { account, did, lastAuthenticated, chainId })

      await Promise.all(
        isVerified.map(async (status, index) => {
          log.debug('syncwhitelist whitelisting on wallet:', { status, index, account })
          if (status) {
            return
          }

          await this.wallets[index].whitelistUser(account, did, chainId, lastAuthenticated, log)
        })
      )

      return true
    } catch (e) {
      log.error('syncwhitelist failed:', e.message, e, { account })
      throw e
    }
  }

  async getAuthenticationPeriod() {
    return this.mainWallet.getAuthenticationPeriod()
  }
}

const celoWallet =
  conf.celoEnabled === false
    ? {}
    : {
        42220: new CeloAdminWallet()
      }

export default new MultiWallet({
  122: AdminWallet, // "main" wallet goes first
  ...celoWallet
})

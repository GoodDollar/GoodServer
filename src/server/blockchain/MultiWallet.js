import { assign, every, forOwn, isEmpty, map } from 'lodash'
import AdminWallet from './AdminWallet'
import CeloAdminWallet from './CeloAdminWallet'
import conf from '../server.config'
import logger from '../../imports/logger'

const multiLogger = logger.child({ from: 'MultiWallet' })
class MultiWallet {
  mainWallet = null
  otherWallets = []
  wallets = []
  walletsMap = {}
  defaultChainId = null

  get ready() {
    return Promise.all(map(this.wallets, 'ready')).then(() => this.mainWallet.addresses)
  }

  constructor(walletsMap) {
    let mainWallet
    let defaultChainId
    if (conf.celoEnabled === false) {
      delete walletsMap[42220]
    }

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

  async topWallet(account, chainId = null, log = multiLogger) {
    const runTx = wallet => wallet.topWallet(account, log)

    if (chainId === 'all') {
      const res = await Promise.all(this.wallets.map(_ => runTx(_).catch(e => e)))
      const e = res.find(_ => _ instanceof Error)
      if (e) throw e
      else return res
    }

    const { walletsMap, defaultChainId } = this
    const chain = chainId && chainId in walletsMap ? chainId : defaultChainId

    return runTx(walletsMap[chain])
  }

  async whitelistUser(account, did) {
    return Promise.all(this.wallets.map(wallet => wallet.whitelistUser(account, did)))
  }

  async removeWhitelisted(account) {
    return Promise.all(this.wallets.map(wallet => wallet.removeWhitelisted(account)))
  }

  async isVerified(account) {
    return this.mainWallet.isVerified(account)
  }

  async syncWhitelist(account, log = multiLogger) {
    const [isVerifiedMain, ...atOtherWallets] = await Promise.all(
      this.wallets.map(wallet => wallet.isVerified(account))
    )

    log.debug('syncwhitelist:', { account, isVerifiedMain, atOtherWallets })

    if (!isVerifiedMain || isEmpty(atOtherWallets) || every(atOtherWallets)) {
      return false
    }

    const did = await this.mainWallet.getDID(account).catch(() => account)

    log.debug('syncwhitelist:', { account, did })

    await Promise.all(
      atOtherWallets.map(async (status, index) => {
        log.debug('syncwhitelist whitelisting on wallet:', { status, index, account })
        if (status) {
          return
        }

        await this.otherWallets[index].whitelistUser(account, did, log)
      })
    )

    return true
  }

  async getAuthenticationPeriod() {
    return this.mainWallet.getAuthenticationPeriod()
  }
}

export default new MultiWallet({
  122: AdminWallet, // "main" wallet goes first
  42220: CeloAdminWallet
})

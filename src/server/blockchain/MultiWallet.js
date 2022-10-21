import { assign, every, forOwn, isEmpty, map } from 'lodash'
import AdminWallet from './AdminWallet'
import CeloAdminWallet from './CeloAdminWallet'
import conf from '../server.config'
import logger from '../../imports/logger'

class MultiWallet {
  mainWallet = null
  otherWallets = []
  wallets = []
  walletsMap = {}
  defaultChainId = null
  logger = null

  get ready() {
    return Promise.all(map(this.wallets, 'ready')).then(() => this.mainWallet.addresses)
  }

  constructor(walletsMap, logger) {
    let mainWallet
    let defaultChainId

    forOwn(walletsMap, (wallet, chainId) => {
      this.wallets.push(wallet)

      if (mainWallet) {
        this.otherWallets.push(wallet)
      } else {
        mainWallet = wallet
        defaultChainId = chainId
      }
    })

    logger.debug('MultiWallet constructor:', {
      wallets: Object.keys(walletsMap),
      mainWallet: mainWallet.networkId,
      otherWallets: this.otherWallets.map(_ => _.networkId)
    })

    assign(this, { walletsMap, mainWallet, defaultChainId, logger })
  }

  async topWallet(account, chainId = null, customLogger = null) {
    const runTx = wallet => wallet.topWallet(account, customLogger || this.logger)

    if (chainId === 'all') {
      return Promise.all(this.wallets.map(runTx))
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

  async syncWhitelist(account, customLogger = null) {
    const log = customLogger || this.logger
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

// adds celo wallet if feature enabled
const celoWallet = !conf.celoEnabled // here was the issue - had to be NOT celo enabled
  ? {}
  : {
      42220: CeloAdminWallet
    }

export default new MultiWallet(
  {
    122: AdminWallet, // "main" wallet goes first
    ...celoWallet
  },
  logger.child({ from: 'MultiWallet' })
)

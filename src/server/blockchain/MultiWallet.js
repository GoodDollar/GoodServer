import { assign, every, forOwn, isEmpty } from 'lodash'
import AdminWallet from './AdminWallet'
import CeloAdminWallet from './CeloAdminWallet'

import conf from '../server.config'

class MultiWallet {
  mainWallet = null
  otherWallets = []
  wallets = []
  walletsMap = {}
  defaultChainId = null

  constructor(walletsMap) {
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

    assign(this, { walletsMap, mainWallet, defaultChainId })
  }

  async topWallet(account, chainId = null, log) {
    const runTx = wallet => wallet.topWallet(account, log)

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

  async syncWhitelist(account) {
    const [isVerified, ...atOtherWallets] = await Promise.all(this.wallets.map(wallet => wallet.isVerified(account)))

    if (!isVerified || isEmpty(atOtherWallets) || every(atOtherWallets)) {
      return false
    }

    const did = await this.mainWallet.getDID(account).catch(() => account)

    await Promise.all(
      atOtherWallets.map(async (status, index) => {
        if (status) {
          return
        }

        await this.otherWallets[index].whitelistUser(account, did)
      })
    )

    return true
  }

  async getAuthenticationPeriod() {
    return this.mainWallet.getAuthenticationPeriod()
  }
}

let wallets = {
  122: AdminWallet // "main" wallet goes first
}

if (conf.celoEnabled) {
  wallets = {
    ...wallets,
    42220: CeloAdminWallet
  }
}

export default new MultiWallet(wallets)

import { assign, every, forOwn } from 'lodash'
import AdminWallet from './AdminWallet'
import CeloAdminWallet from './CeloAdminWallet'

class MultiWallet {
  mainWallet = null
  otherWallets = []
  wallets = []
  walletsMap = {}

  constructor(walletsMap) {
    let mainWallet

    forOwn(walletsMap, wallet => {
      this.wallets.push(wallet)

      if (mainWallet) {
        this.otherWallets.push(wallet)
      } else {
        mainWallet = wallet
      }
    })

    assign(this, { walletsMap, mainWallet })
  }

  async topWallet(account, chainId = 122, log) {
    const runTx = wallet => wallet.topWallet(account, log)

    if (chainId === 'all') {
      return Promise.all(this.wallets.map(runTx))
    }

    const { walletsMap } = this
    const chain = chainId in walletsMap ? chainId : 122

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

    if (!isVerified || every(atOtherWallets)) {
      return false
    }

    const did = await this.mainWallet.getDID(account).catch(_ => account)

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

export default new MultiWallet({
  122: AdminWallet, // "main" wallet goes first
  42220: CeloAdminWallet
})

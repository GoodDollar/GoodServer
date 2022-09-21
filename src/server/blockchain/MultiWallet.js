import AdminWallet from './AdminWalletV2'
import CeloAdminWallet from './CeloAdminWallet'

export default {
  topWallet: async (account, chainId = 122, log) => {
    switch (chainId) {
      default:
      case 122:
        return AdminWallet.topWallet(account, log)
      case 42220:
        return CeloAdminWallet.topWallet(account, log)
      case 'all':
        return Promise.all([AdminWallet.topWallet(account, log), CeloAdminWallet.topWallet(account, log)])
    }
  },
  whitelistUser: async (account, did, orgChainId = 122) => {
    return Promise.all([AdminWallet.whitelistUser(account, did), CeloAdminWallet.whitelistUser(account, did)])
  },
  removeWhitelisted: async account => {
    return Promise.all([AdminWallet.removeWhitelisted(account), CeloAdminWallet.removeWhitelisted(account)])
  },
  isVerified: async account => {
    return AdminWallet.isVerified(account)
  },
  syncWhitelist: async account => {
    const [isFuse, isCelo] = await Promise.all([AdminWallet.isVerified(account), CeloAdminWallet.isVerified(account)])
    if (isFuse && !isCelo) {
      const did = await AdminWallet.getDID(account).catch(_ => account)
      await CeloAdminWallet.whitelistUser(account, did)
      return true
    }
    return false
  },
  getAuthenticationPeriod: async () => {
    return AdminWallet.getAuthenticationPeriod()
  }
}

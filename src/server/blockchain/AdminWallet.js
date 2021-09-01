import conf from '../server.config'
let AdminWallet
// export default AdminWallet
if (['production'].includes(conf.network)) {
  AdminWallet = require('./AdminWalletOld').default
} else {
  AdminWallet = require('./AdminWalletV2').default
}
export default AdminWallet

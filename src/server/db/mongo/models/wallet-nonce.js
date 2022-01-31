import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_WALLET_NONCE } from './constants'

export const WalletNonceSchema = new Schema({
  address: {
    type: String
  },
  networkId: {
    type: String
  },
  nonce: {
    type: Number,
    default: 0
  },
  isLock: {
    type: Boolean,
    default: false
  },
  lockedAt: Date
})
WalletNonceSchema.index({ address: 1, networkId: 1 }, { unique: true }) // schema level
WalletNonceSchema.index({ isLock: 1, networkId: 1 }, { unique: false }) // schema level

export default mongoose.model(MODEL_WALLET_NONCE, WalletNonceSchema)

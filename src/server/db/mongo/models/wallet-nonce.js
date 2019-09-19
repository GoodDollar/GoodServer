import mongoose from '../../mongo-db.js'
import { MODEL_WALLET_NONCE } from './constants'

export const WalletNonceSchema = new mongoose.Schema({
  address: {
    type: String,
    index: { unique: true }
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

export default mongoose.model(MODEL_WALLET_NONCE, WalletNonceSchema)

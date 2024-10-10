import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_IPCACHE } from './constants.js'

export const IpAccountsCacheSchema = new Schema(
  {
    ip: {
      type: String,
      index: { unique: true },
      required: true
    },
    accounts: {
      type: [String],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { minimize: false }
)
IpAccountsCacheSchema.index({ timestamp: 1 }, { expireAfterSeconds: 48 * 60 * 60 }) //48 hours

export default mongoose.model(MODEL_IPCACHE, IpAccountsCacheSchema)

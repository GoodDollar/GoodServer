import mongoose from '../../mongo-db.js'
import { MODEL_USER_PRIVATE } from './constants'

export const UserPrivateSchema = new mongoose.Schema({
  identifier: {
    type: String,
    index: { unique: true }
  },
  email: {
    type: String,
    index: { unique: true }
  },
  mobile: {
    type: String,
  },
  fullName: {
    type: String,
  }
})

export default mongoose.db.model(MODEL_USER_PRIVATE, UserPrivateSchema)

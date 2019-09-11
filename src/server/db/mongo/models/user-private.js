import mongoose from '../../mongo-db.js'
import { MODEL_USER_PRIVATE } from './constants'

export const UserPrivateSchema = new mongoose.Schema({
  identifier: {
    type: String,
    index: { unique: true },
    required: true
  },
  fullName: {
    type: String
  },
  mauticId: {
    type: String
  },
  email: {
    type: String
  },
  mobile: {
    type: String
  },
  jwt: {
    type: String
  },
  smsValidated: {
    type: Boolean
  },
  isEmailConfirmed: {
    type: Boolean,
    default: false
  },
  otp: {
    type: {
      code: String,
      expirationDate: String
    }
  },
  emailVerificationCode: {
    type: String
  }
})

export default mongoose.model(MODEL_USER_PRIVATE, UserPrivateSchema)

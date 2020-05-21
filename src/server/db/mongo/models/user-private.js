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
  loginToken: {
    type: String
  },
  w3Token: {
    type: String
  },
  smsValidated: {
    type: Boolean
  },
  isEmailConfirmed: {
    type: Boolean,
    default: false
  },
  isVerified: {
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
  },
  regMethod: {
    type: String
  },
  torusProvider: {
    type: String
  },
  createdDate: {
    type: Date
  },
  magiclink: {
    type: String
  },
  mnemonic: {
    type: String
  },
  hanukaBonus: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isCompleted: {
    whiteList: {
      type: Boolean,
      default: false
    },
    w3Record: {
      type: Boolean,
      default: false
    },
    marketToken: {
      type: Boolean,
      default: false
    },
    topWallet: {
      type: Boolean,
      default: false
    }
  },
  claimQueue: {
    date: { type: Date, default: Date.now },
    status: { type: String, index: { unique: false } }
  }
})

export default mongoose.model(MODEL_USER_PRIVATE, UserPrivateSchema)

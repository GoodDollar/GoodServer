import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_USER_PRIVATE } from './constants'

export const UserPrivateSchema = new Schema(
  {
    identifier: {
      type: String,
      index: { unique: true },
      required: true
    },
    fullName: {
      type: String
    },
    mauticId: {
      type: String,
      index: { unique: false }
    },
    crmId: {
      type: String,
      index: { unique: false }
    },
    email: {
      type: String,
      index: { unique: false }
    },
    mobile: {
      type: String,
      index: { unique: false }
    },
    walletAddress: {
      type: String,
      index: { unique: false }
    },
    jwt: {
      type: String
    },
    loginToken: {
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
      email: String,
      mobile: String
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
      type: Date,
      index: true
    },
    magiclink: {
      type: String
    },
    mnemonic: {
      type: String
    },
    profilePublickey: {
      type: String
    },
    isCompleted: {
      whiteList: {
        type: Boolean,
        default: false
      },
      topWallet: {
        type: Boolean,
        default: false
      }
    },
    trustIndex: {
      type: Date,
      default: Date.now
    },
    lastLogin: {
      type: Date
    },
    ageVerified: {
      type: Boolean,
      default: false
    }
  },
  { minimize: false }
)

export default mongoose.model(MODEL_USER_PRIVATE, UserPrivateSchema)

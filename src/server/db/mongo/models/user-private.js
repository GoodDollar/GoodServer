import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_USER_PRIVATE } from './constants'

export const caseInsensitive = { locale: 'en', strength: 2 }

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
      type: String
    },
    email: {
      type: String,
      index: { unique: false }
    },
    mobile: {
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
    claimQueue: {
      date: { type: Date, default: Date.now },
      status: { type: String, index: { unique: false } }
    },
    trustIndex: {
      type: Boolean,
      default: false
    },
    lastLogin: {
      type: Date
    }
  },
  { minimize: false }
)

UserPrivateSchema.index({ identifier: 1 }, { unique: true, collation: caseInsensitive, name: 'identifier_insensitive' })

export default mongoose.model(MODEL_USER_PRIVATE, UserPrivateSchema)

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
    type: String,
    index: { unique: true }
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
    type: Object
  },
  emailVerificationCode: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: Date
})

/**
 * Set Time updat
 */
UserPrivateSchema.pre('update', function(next) {
  this.update({}, { $set: { updatedAt: new Date() } })
  next()
})

export default mongoose.db.model(MODEL_USER_PRIVATE, UserPrivateSchema)

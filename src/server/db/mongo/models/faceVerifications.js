import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_FACE_VERIFICATIONS } from './constants'

export const FaceVerificationsSchema = new Schema({
  lastFVDate: {
    type: Date
  },
  enrollmentIdentifier: {
    type: String
  }
})
FaceVerificationsSchema.index({ lastFVDate: 1 }, { unique: true }) // schema level
FaceVerificationsSchema.index({ enrollmentIdentifier: 1 }, { unique: true }) // schema level

export default mongoose.model(MODEL_FACE_VERIFICATIONS, FaceVerificationsSchema)

import mongoose, { Schema } from '../../mongo-db.js'
import { MODEL_FACE_VERIFICATIONS } from './constants'

export const FaceVerificationsSchema = new Schema({
  lastFVDate: {
    type: Date,
    index: true,
    required: true
  },
  enrollmentIdentifier: {
    type: String,
    index: { unique: true },
    required: true
  }
})

export default mongoose.model(MODEL_FACE_VERIFICATIONS, FaceVerificationsSchema)

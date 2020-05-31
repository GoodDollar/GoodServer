import mongoose from '../../mongo-db.js'
import { MODEL_PROPERTIES } from './constants'

export const PropsSchema = new mongoose.Schema({
  name: {
    type: String
  },
  value: {}
})
PropsSchema.index({ name: 1 }, { unique: true }) // schema level

export default mongoose.model(MODEL_PROPERTIES, PropsSchema)

import mongoose, { Schema, Types } from '../../mongo-db.js'
import { MODEL_PROPERTIES } from './constants'

const schemaOptions = { discriminatorKey: 'name' }

const PropsSchema = new Schema(
  {
    name: {
      type: String
    },
    value: {
      type: Types.Mixed
    }
  },
  schemaOptions
)

PropsSchema.index({ name: 1 }, { unique: true }) // schema level

const PropsModel = mongoose.model(MODEL_PROPERTIES, PropsSchema)

export const DatabaseVersion = PropsModel.discriminator(
  'DATABASE_VERSION',
  new Schema(
    {
      value: {
        default: {},
        type: new Schema({
          version: Number
        })
      }
    },
    schemaOptions
  )
)

export const MessageStrings = PropsModel.discriminator(
  'MESSAGE_STRINGS',
  new Schema(
    {
      value: {
        default: {},
        type: Types.Mixed
      }
    },
    schemaOptions
  )
)

export default PropsModel

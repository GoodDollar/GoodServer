import mongoose from 'mongoose'

import config from '../server.config'

const { uri } = config.mongodb
const mongoOpts = {
  autoIndex: true,
  minPoolSize: 20,
  maxPoolSize: 100
}

export const { Schema } = mongoose
export const { Types } = Schema

mongoose.set('strictQuery', true)
mongoose.connect(uri, mongoOpts)

export default mongoose

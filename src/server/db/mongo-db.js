import mongoose from 'mongoose'

import config from '../server.config'

const { uri } = config.mongodb
const mongoOpts = {
  useNewUrlParser: true,
  useCreateIndex: true,
  autoIndex: true,
  useFindAndModify: false,
  useUnifiedTopology: true
}

export const { Schema } = mongoose
export const { Types } = Schema

mongoose.connect(uri, mongoOpts)

export default mongoose

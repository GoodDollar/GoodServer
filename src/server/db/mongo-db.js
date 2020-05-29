import mongoose from 'mongoose'

import config from '../server.config'

const { uri } = config.mongodb

export const { Schema } = mongoose
export const { Types } = Schema

mongoose.connect(uri, { useNewUrlParser: true, useCreateIndex: true, autoIndex: true, useFindAndModify: false })

export default mongoose

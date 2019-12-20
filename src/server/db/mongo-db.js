import mongoose from 'mongoose'
import config from '../server.config'

const { uri } = config.mongodb
if (uri) {
  console.log('START MONGO')
  mongoose.connect(uri, { useNewUrlParser: true, useCreateIndex: true })
} else {
  console.log('START MONGO MEMORY')
  const { getMongoMemoryServerConnectionString } = require('./mongo-memory')
  getMongoMemoryServerConnectionString().then(memoryUri =>
    mongoose.connect(memoryUri, { useNewUrlParser: true, useCreateIndex: true })
  )
}

export default mongoose

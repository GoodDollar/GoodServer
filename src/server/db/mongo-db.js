import mongoose from 'mongoose'

import config from '../server.config'

const { uri, user, pass, dbName } = config.mongodb
mongoose.Promise = Promise
mongoose.db = mongoose.createConnection(uri, {
  user,
  pass,
  dbName,
  useNewUrlParser: true
})

export default mongoose

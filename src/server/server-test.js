/* eslint-disable import/no-extraneous-dependencies */
import conf from './server.config'
import mongoose from './db/mongo-db'
import startApp from './app'

const PORT = conf.port || 4000

const makeServer = async () => {
  let server
  const app = await startApp()

  await new Promise((res, rej) => (server = app.listen(PORT, err => (err ? rej(err) : res()))))
  console.log(`App listening to ${PORT}....`)

  await mongoose.connection.asPromise()
  console.log(`MongoDB ready...`)

  await new Promise(res => setTimeout(res, 1000))
  console.log('make server ready')

  return server
}

export default makeServer

import 'newrelic'
import path from 'path'
import express from 'express'
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import app from './app'

const Timeout = (timeout, err) => {
  return new Promise((res, rej) => {
    setTimeout(rej, timeout, new Error('Request Timeout:' + err))
  })
}
export default function start(workerId) {
  console.log(`start workerId = ${workerId}`)

  process.on('uncaughtException', (err, origin) => {
    console.log(`Uncaught exception: ${err}\nException origin: ${origin}`)
    process.exit(-1)
  })
  process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason)
    // Application specific logging, throwing an error, or other logic here
  })

  const DIST_DIR = __dirname

  const HTML_FILE = path.join(DIST_DIR, 'index.html')

  app.use(express.static(DIST_DIR))

  app.get('*', (req, res) => {
    res.sendFile(HTML_FILE)
  })

  const PORT = process.env.PORT || 3000
  const server = app.listen(PORT, () => {
    console.log(`App listening to ${PORT}....`)
    console.log('Press Ctrl+C to quit.')
  })

  Promise.race([
    Timeout(30000, 'gun not initialized'),
    GunDBPublic.init(server, conf.gundbPassword, `publicdb${workerId}`, conf.gunPublicS3)
  ]).catch(e => {
    console.log('gun failed... quiting', e)
    process.exit(-1)
  })
}

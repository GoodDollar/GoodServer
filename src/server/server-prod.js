const throng = require('throng')
function start(workerId) {
  require('newrelic')
  const path = require('path')
  const express = require('express')
  const conf = require('./server.config')
  const { GunDBPublic } = require('./gun/gun-middleware')
  console.log(`start workerId = ${workerId}`)
  const app = require('./app').default

  process.on('uncaughtException', (err, origin) => {
    console.log(`Caught exception: ${err}\n` + `Exception origin: ${origin}`)
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

  GunDBPublic.init(server, conf.gundbPassword, `publicdb${workerId}`, conf.gunPublicS3)
}
throng({ workers: process.env.WEB_CONCURRENCY, lifetime: Infinity }, start)

import path from 'path'
import express from 'express'
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import app from './app'

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

GunDBPublic.init(server, conf.gundbPassword, 'publicdb')

import 'newrelic'
import path from 'path'
import express from 'express'
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import app from './app'

const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  console.log(`App listening to ${PORT}....`)
  console.log('Press Ctrl+C to quit.')
})

GunDBPublic.init(server, conf.gundbPassword, 'publicdb', conf.gunPublicS3)

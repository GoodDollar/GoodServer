import path from "path"
import express from "express"
import middlewares from "./server-middlewares"
import conf from './server.config'
import { GunDBPublic } from './gun/gun-middleware'
import logger from './imports/pino-logger'


const log = logger.child({ from: 'server-prod' })


const app = express();


const DIST_DIR = __dirname;


const HTML_FILE = path.join(DIST_DIR, "index.html")


app.use(express.static(DIST_DIR))

middlewares(app, "prod")

app.get("*", (req, res) => {
  res.sendFile(HTML_FILE)
})


const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  log.trace(`App listening to ${PORT}....`)
  log.trace("Press Ctrl+C to quit.")
})

GunDBPublic.init(server, conf.gundbPassword, 'publicdb')

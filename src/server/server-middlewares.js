// @flow
import { Router } from 'express'
import type { $Request, $Response, NextFunction } from 'express'
import bodyParser from "body-parser"
import cors from "cors"
import pino from 'express-pino-logger'
import addLoginMiddlewares from "./login/login-middleware"
import { setup as addGunMiddlewares, GunDBPrivate } from "./gun/gun-middleware"
import addStorageMiddlewares from "./storage/storageAPI"
import addVerificationMiddlewares from "./verification/verificationAPI"
import VerificationAPI from "./verification/verifications"

import logger from '../imports/pino-logger'
import conf from './server.config'

function wrapAsync(fn: Function) {
  return function (req: $Request & { log: any }, res: $Response, next: NextFunction) {
    const log = req.log.child({ from: 'wrapAsync' })
    // Make sure to `.catch()` any errors and pass them along to the `next()`
    // middleware in the chain, in this case the error handler.
    fn({ ...req, log: logger }, res, next).catch((error) => {
      log.error(error)
      next(error)
    });
  };
}

/**
 * Prevents logging header information when logging
 * @param fn
 * @returns {Function}
 */
function lightLogs(fn: Function) {
  return function (req: $Request, res: $Response, next: NextFunction) {
    fn({ ...req, log: logger }, res, next)
  }
}

/**
 * If in production execute the following middleware
 * @param req
 * @param res
 * @param next
 */
function onlyInProduction(req: $Request, res: $Response, next: NextFunction) {
  if (conf.env === 'production') {
    next()
    return
  }
  res.json({ ok: 1 })
}

export { wrapAsync, onlyInProduction, lightLogs }
export default (app: Router, env: any) => {
  // parse application/x-www-form-urlencoded
  // for easier testing with Postman or plain HTML forms
  app.use(bodyParser.urlencoded({
    extended: true
  }));


  // parse application/json
  app.use(bodyParser.json())

  app.options(cors())
  app.use(cors())

  app.use(pino({ logger }))

  addLoginMiddlewares(app)
  addGunMiddlewares(app)
  addStorageMiddlewares(app, GunDBPrivate)
  addVerificationMiddlewares(app, VerificationAPI, GunDBPrivate)

  app.use((error, req, res, next: NextFunction) => {
    const log = req.log.child({ from: 'errorHandler' })
    log.error({ error });
    res.status(400).json({ message: error.message });
  });
}

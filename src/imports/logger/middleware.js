// @flow
import { omit, isPlainObject, assign } from 'lodash'
import Crypto from 'crypto'

import { redactFieldsDuringLogging as fvRedact } from '../../server/verification/utils/logger'
import { whenFinished } from '../../server/utils/request'

export const createLoggerMiddleware = logger => (req, res, next) => {
  const startTime = Date.now()
  const uuid = Crypto.createHash('sha1')
    .update(Math.random() + ' ' + startTime)
    .digest('base64')
    .slice(0, 10)

  const { url, user } = req
  const log = logger.child({ uuid, from: url, userId: user && user.identifier })

  assign(req, { log })

  whenFinished(req, res).then(aborted => {
    const logMessage = 'Incoming Request' + (aborted ? ' [aborted]' : '')
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let { method, body: logBody, query, headers } = req
    let { statusCode, statusMessage } = res

    if (url.startsWith('/verify/') && isPlainObject(logBody)) {
      logBody = omit(logBody, fvRedact)
    }

    // trace will reduce heroku logs clutter
    log[aborted ? 'warn' : 'trace']('http', logMessage, {
      responseTimeSeconds,
      method,
      body: logBody,
      query,
      headers,
      statusCode,
      statusMessage
    })
  })

  return next()
}

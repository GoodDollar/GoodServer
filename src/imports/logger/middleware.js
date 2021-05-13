// @flow
import once from 'events.once'
import { omit, isPlainObject, assign } from 'lodash'
import Crypto from 'crypto'

import { redactFieldsDuringLogging as fvRedact } from '../../server/verification/utils/logger'

export const createLoggerMiddleware = logger => (req, res, next) => {
  const startTime = Date.now()
  const uuid = Crypto.createHash('sha1')
    .update(Math.random() + ' ' + startTime)
    .digest('base64')
    .slice(0, 10)

  const log = logger.child({ uuid, from: req.url, userId: req.user && req.user.identifier })

  assign(req, { log })

  Promise.race([once(req, 'close').then(() => true), once(res, 'finish').then(() => false)]).then(aborted => {
    const logMessage = 'Incoming Request' + (aborted ? ' [aborted]' : '')
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let { url, method, body: logBody, query, headers } = req

    if (url.startsWith('/verify/face/') && isPlainObject(logBody)) {
      logBody = omit(logBody, fvRedact)
    }

    log[aborted ? 'warn' : 'info']('http', logMessage, {
      responseTimeSeconds,
      method,
      body: logBody,
      query,
      headers
    })
  })

  return next()
}

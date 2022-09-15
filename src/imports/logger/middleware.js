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
  const whenClosed = once(req, 'close').then(() => {
    const { destroyed } = req

    log.debug('request closed', { destroyed })
    return destroyed
  })

  const whenFinished = once(res, 'finish').then(() => {
    log.debug('response sent')
    return false
  })

  assign(req, { log })

  Promise.race([whenClosed, whenFinished]).then(aborted => {
    const logMessage = 'Incoming Request' + (aborted ? ' [aborted]' : '')
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let { url, method, body: logBody, query, headers } = req
    let { statusCode, statusMessage } = res
    if (url.startsWith('/verify/face/') && isPlainObject(logBody)) {
      logBody = omit(logBody, fvRedact)
    }

    log[aborted ? 'warn' : 'info']('http', logMessage, {
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

// @flow
import { omit, isPlainObject, assign } from 'lodash'
import Crypto from 'crypto'

export const createLoggerMiddleware = logger => (req, res, next) => {
  const startTime = Date.now()
  const uuid = Crypto.createHash('sha1')
    .update(Math.random() + ' ' + startTime)
    .digest('base64')
    .slice(0, 10)

  const log = logger.child({ uuid, from: req.url, userId: req.user && req.user.identifier })

  const logRequest = () => {
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let { url, method, body: logBody, query, headers } = req

    if (url.startsWith('/verify/face/') && isPlainObject(logBody)) {
      logBody = omit(logBody, 'faceMap', 'auditTrailImage', 'lowQualityAuditTrailImage')
    }

    log.info('http', 'Incoming Request', {
      responseTimeSeconds,
      method,
      body: logBody,
      query,
      headers
    })
  }

  assign(req, { log })
  req.on('abort', logRequest)
  res.on('finish', logRequest)

  next()
}

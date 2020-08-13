// @flow
import { omit, isPlainObject } from 'lodash'
import Crypto from 'crypto'

export const createLoggerMiddleware = logger => (req, res, next) => {
  const startTime = Date.now()
  let uuid = Math.random() + ' ' + startTime

  uuid = Crypto.createHash('sha1')
    .update(uuid)
    .digest('base64')
    .slice(0, 10)

  req.log = logger.child({ uuid, from: req.url, userId: req.user && req.user.identifier })

  res.on('finish', () => {
    const responseTimeSeconds = (Date.now() - startTime) / 1000
    let logBody = req.body

    if (req.url.startsWith('/verify/face/') && isPlainObject(logBody)) {
      logBody = omit(logBody, 'faceMap', 'auditTrailImage', 'lowQualityAuditTrailImage')
    }

    req.log.log('http', 'Incoming Request', {
      responseTimeSeconds,
      method: req.method,
      body: logBody,
      query: req.query,
      headers: req.headers
    })
  })

  next()
}

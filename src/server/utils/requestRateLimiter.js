import rateLimit from 'express-rate-limit'
import config from '../server.config'
import requestIp from 'request-ip'

const { rateLimitMinutes, rateLimitRequestsCount } = config

const makeOpts = (limit, minutesWindow) => ({
  windowMs: Math.round((minutesWindow || +rateLimitMinutes) * 60 * 1000), // minutes
  max: limit || +rateLimitRequestsCount // limit each IP to n requests per windowMs
})

const makeUserKey = request => {
  const { user } = request
  const { loggedInAs } = user || {}

  return loggedInAs || request.getClientIp(request)
}

export const userRateLimiter = (limit, minutesWindow) =>
  rateLimit({
    ...makeOpts(limit, minutesWindow),
    keyGenerator: makeUserKey,
    message: 'per account rate limit exceeded'
  })

export default (limit, minutesWindow) =>
  rateLimit({ ...makeOpts(limit, minutesWindow), keyGenerator: requestIp.getClientIp })

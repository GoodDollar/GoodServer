import rateLimit from 'express-rate-limit'
import config from '../server.config'

const { rateLimitMinutes, rateLimitRequestsCount } = config

const makeOpts = (limit, minutesWindow) => ({
  windowMs: Math.round((minutesWindow || +rateLimitMinutes) * 60 * 1000), // minutes
  max: limit || +rateLimitRequestsCount // limit each IP to n requests per windowMs
})

const makeUserKey = request => {
  const { ip, user } = request
  const { loggedInAs } = user || {}

  return loggedInAs || ip
}

export const userRateLimiter = (limit, minutesWindow) =>
  rateLimit({
    ...makeOpts(limit, minutesWindow),
    keyGenerator: makeUserKey,
    message: 'per account rate limit exceeded'
  })

export default (limit, minutesWindow) => rateLimit(makeOpts(limit, minutesWindow))

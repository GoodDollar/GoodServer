import rateLimit, { MemoryStore } from 'express-rate-limit'
import config from '../server.config'
import * as redis from 'redis'
import RedisStore from 'rate-limit-redis'
import logger from '../../imports/logger'
import requestIp from 'request-ip'

const log = logger.child({ from: 'requestRateLimiter' })

const { rateLimitMinutes, rateLimitRequestsCount, redisUrl } = config

const makeStore = () => {
  try {
    if (!redisUrl) {
      throw new Error('No Redis URL set, fallback to MemoryStore')
    }

    const client = redis.createClient(
      { url: redisUrl },
      { no_ready_check: true, socket_keepalive: true, retry_strategy: () => 5000 }
    )
    const connectionState = client.connect()

    // Redis store configuration
    return new RedisStore({
      sendCommand: async (...args) => {
        try {
          await connectionState
          return client.sendCommand(args)
        } catch (e) {
          log.error('redis command failed:', e.message, e, { args })
          return {}
        }
      }
    })
  } catch (e) {
    log.error('redis init failed', e.message, e)
    return new MemoryStore()
  }
}

const store = makeStore()

const makeUserKey = (bucketKey, byUserId) => request => {
  const { user } = request
  const { loggedInAs } = user || {}

  const bucket = bucketKey || request.route.path
  const identifier = byUserId ? loggedInAs || requestIp.getClientIp(request) : requestIp.getClientIp(request)

  return `${bucket}_${identifier}`
}

const makeOpts = (limit, minutesWindow, bucketKey) => ({
  windowMs: Math.round((minutesWindow || +rateLimitMinutes) * 60 * 1000), // minutes
  max: limit || +rateLimitRequestsCount, // limit each IP to n requests per windowMs
  store,
  keyGenerator: makeUserKey(bucketKey, false)
})

export const userRateLimiter = (limit, minutesWindow, bucketKey) =>
  rateLimit({
    ...makeOpts(limit, minutesWindow, bucketKey),
    keyGenerator: makeUserKey(bucketKey, true),
    message: 'per account rate limit exceeded'
  })

export default (limit, minutesWindow, bucketKey) => rateLimit({ ...makeOpts(limit, minutesWindow, bucketKey) })

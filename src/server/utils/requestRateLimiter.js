import rateLimit, { MemoryStore } from 'express-rate-limit'
import config from '../server.config'
import * as Redis from 'ioredis'
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

    const client = new Redis(redisUrl, {
      keepAlive: true,
      retryStrategy: times => {
        if (times > 200) {
          log.error('unable to reconnect to redis')
          return
        }
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      reconnectOnError: e => {
        log.error('redis reconnecting on error', e.message, e)
        return true
      }
    })

    client.on('error', e => log.error('redis error', e.meesage, e))

    // const connectionState = client.connect()

    // Redis store configuration
    return new RedisStore({
      sendCommand: async (...args) => {
        try {
          // await connectionState
          const res = await client.call(...args)
          return res
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

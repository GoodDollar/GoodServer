import rateLimit, { MemoryStore } from 'express-rate-limit'
import config from '../server.config'
import * as Redis from 'ioredis'
import RedisStore from 'rate-limit-redis'
import logger from '../../imports/logger'
import { getClientIp } from './clientIp'
import FailOpenStore from './failOpenStore'

const log = logger.child({ from: 'requestRateLimiter' })

const { rateLimitMinutes, rateLimitRequestsCount, redisUrl } = config

const makeStore = () => {
  try {
    if (!redisUrl) {
      throw new Error('No Redis URL set, fallback to MemoryStore')
    }

    const client = new Redis(redisUrl, {
      keepAlive: true,
      commandTimeout: 1000, // bound the delay a redis outage adds to each request
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

    client.on('error', e => log.error('redis error', e.message, e))

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
          throw e // handled by FailOpenStore
        }
      }
    })
  } catch (e) {
    log.error('redis init failed', e.message, e)
    return new MemoryStore()
  }
}

// the in-memory fallback keeps one counter per worker: with several workers (or instances) the effective limit
// is multiplied, so production deployments should set REDISCLOUD_URL
if (!redisUrl && ['production', 'staging'].includes(config.env) && Number(process.env.WEB_CONCURRENCY) > 1) {
  log.error(
    'rate limiting uses a per-worker memory store: set REDISCLOUD_URL, limits are multiplied by the number of workers'
  )
}

const store = new FailOpenStore(makeStore(), log)

const makeUserKey = (bucketKey, byUserId) => request => {
  const { user } = request
  const { loggedInAs } = user || {}

  const bucket = bucketKey || request.route.path
  const identifier = byUserId ? loggedInAs || getClientIp(request) : getClientIp(request)

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

import rateLimit, { MemoryStore } from 'express-rate-limit'
import config from '../server.config'
import * as redis from 'redis'
import RedisStore from 'rate-limit-redis'
import logger from '../../imports/logger'

const log = logger.child({ from: 'requestRateLimiter' })

const { rateLimitMinutes, rateLimitRequestsCount } = config

let redisClient,
  store = new MemoryStore()
try {
  if (process.env.REDISCLOUD_URL) {
    redisClient = redis.createClient({ url: process.env.REDISCLOUD_URL }, { no_ready_check: true })
    const connectPromise = redisClient.connect()
    // Redis store configuration
    store = new RedisStore({
      sendCommand: async (...args) => {
        try {
          await connectPromise
          return redisClient.sendCommand(args)
        } catch (e) {
          log.error('redis command failed:', e.message, e, { args })
          return {}
        }
      }
    })
  }
} catch (e) {
  log.error('redis init failed', e.message, e)
}

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

export default (limit, minutesWindow) => rateLimit({ ...makeOpts(limit, minutesWindow), store })

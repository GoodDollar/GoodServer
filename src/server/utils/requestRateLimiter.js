import rateLimit, { MemoryStore } from 'express-rate-limit'
import config from '../server.config'
import redis from 'redis'
import RedisStore from 'rate-limit-redis'

const { rateLimitMinutes, rateLimitRequestsCount } = config

let redisClient,
  store = new MemoryStore()
try {
  redisClient = redis.createClient(process.env.REDISCLOUD_URL, { no_ready_check: true })
  // Redis store configuration
  store = new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args)
  })
} catch (e) {
  console.log('redis failed', { e })
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

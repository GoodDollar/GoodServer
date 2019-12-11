import rateLimit from 'express-rate-limit'
import config from '../server.config'

const m = config.rateLimitMinutes
const n = config.rateLimitRequestsCount

export default (limit, minutesWindow) =>
  rateLimit({
    windowMs: (minutesWindow || +m) * 60 * 1000, // minutes
    max: limit || +n // limit each IP to n requests per windowMs
  })

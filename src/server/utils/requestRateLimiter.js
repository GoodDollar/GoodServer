import rateLimit from 'express-rate-limit'

export default (t = 1, n = 3) =>
  rateLimit({
    windowMs: +t * 60 * 1000, // minutes
    max: +n // limit each IP to n requests per windowMs
  })

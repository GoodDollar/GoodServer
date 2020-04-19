import throng from 'throng'
import start from './server-prod'

if (process.env.WEB_CONCURRENCY > 1) {
  throng({ workers: process.env.WEB_CONCURRENCY, lifetime: Infinity }, start)
} else {
  start(0)
}

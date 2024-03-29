import throng from 'throng'
import serverStart from './server-prod'
const start = async workerId => {
  return serverStart(workerId)
}
if (process.env.WEB_CONCURRENCY > 1) {
  throng({ count: process.env.WEB_CONCURRENCY, lifetime: Infinity, worker: start, master: () => {} })
} else {
  start(0)
}

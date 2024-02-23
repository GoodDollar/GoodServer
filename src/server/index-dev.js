import throng from 'throng'
import serverStart from './server-dev'
const start = async workerId => {
  console.log('server-dev')
  return serverStart(workerId)
}
if (process.env.WEB_CONCURRENCY > 1) {
  throng({ count: process.env.WEB_CONCURRENCY, lifetime: Infinity, worker: start, master: () => {} })
} else {
  console.log('server-dev start 0')
  start(0)
}

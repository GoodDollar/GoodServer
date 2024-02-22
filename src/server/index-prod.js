import throng from 'throng'

const start = async workerId => {
  const serverStart =
    process.env.ENV === 'production' || process.env.IS_DEPLOYED === 'true'
      ? require('./server-prod').default
      : require('./server-dev').default
  return serverStart(workerId)
}
if (process.env.WEB_CONCURRENCY > 1) {
  throng({ count: process.env.WEB_CONCURRENCY, lifetime: Infinity, worker: start, master: () => {} })
} else {
  start(0)
}

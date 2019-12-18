import throng from 'throng'
import start from './server-prod'

throng({ workers: process.env.WEB_CONCURRENCY, lifetime: Infinity }, start)

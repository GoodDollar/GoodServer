import path from 'path'
import express from 'express'
import startApp from './app'

const MEMORY_LIMIT = process.env.MEMORY_LIMIT || 500

const checkMemory = (workerId, server) => {
  const memoryUsage = process.memoryUsage()
  const used = memoryUsage.heapTotal / 1024 / 1024
  if (used >= MEMORY_LIMIT) {
    console.log('high memory usage: restarting worker', { workerId, MEMORY_LIMIT, used, memoryUsage })
    server.close(() => {
      console.log('high memory usage: server closed, exiting', { workerId })
      process.exit()
    })
  }
}

export default async function start(workerId = 'master') {
  global.workerId = workerId
  console.log(`start workerId = ${workerId}`)

  const DIST_DIR = __dirname

  const HTML_FILE = path.join(DIST_DIR, 'index.html')
  const app = await startApp()

  app.use(express.static(DIST_DIR))

  app.get('*', (req, res) => {
    res.sendFile(HTML_FILE)
  })

  const PORT = process.env.PORT || 3000

  const server = app.listen(PORT, () => {
    console.log(`App listening to ${PORT}....`)
    console.log('Press Ctrl+C to quit.')
  })

  setInterval(checkMemory, 30000, workerId, server)
}

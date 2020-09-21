import path from 'path'
import express from 'express'
import startApp from './app'

export default async function start(workerId) {
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

  app.listen(PORT, () => {
    console.log(`App listening to ${PORT}....`)
    console.log('Press Ctrl+C to quit.')
  })
}

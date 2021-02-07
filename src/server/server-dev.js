/* eslint-disable import/no-extraneous-dependencies */
import webpack from 'webpack'
import webpackHotMiddleware from 'webpack-hot-middleware'
import config from '../../webpack.dev.config'
import conf from './server.config'
import startApp from './app'

const compiler = webpack(config)

export default async function start(workerId = 'master') {
  global.workerId = workerId
  console.log(`started dev workerId = ${workerId}`)
  const app = await startApp()
  app.use(webpackHotMiddleware(compiler))

  console.log({ conf })

  const PORT = conf.port || 8080

  app.listen(PORT, () => {
    console.log(`App listening to ${PORT}....`)
    console.log('Press Ctrl+C to quit.')
  })
}

// @flow
import config from '../server.config'

export const cypressMiddleware = (request, _, callNextMiddleware) => {
  const { headers } = request
  const userAgent = headers['user-agent']
  const isCypress = userAgent && userAgent.includes('Cypress')

  request.isCypress = isCypress
  request.isE2ERunning = isCypress && 'development' === config.env
  callNextMiddleware()
}

export const addCypressMiddleware = app => app.use(cypressMiddleware)

export default addCypressMiddleware

// @flow

import Axios from 'axios'
import { isPlainObject, get } from 'lodash'

import Config from '../server/server.config'
import logger from '../imports/logger'

class FacebookVerifier {
  constructor(Config, httpFactory, logger) {
    const { facebookGraphApiUrl } = Config

    this.logger = logger
    this.http = httpFactory({
      baseURL: facebookGraphApiUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })

    this._configureResponses()
  }

  async verifyEmail(userEmail, accessToken, logger) {
    const { http } = this
    logger = logger || this.logger
    const params = { fields: 'email', access_token: accessToken }
    const userInfo = await http.get('/me', { params })

    logger.info('verifyEmail', { userInfo })

    if (!('email' in userInfo)) {
      throw new Error(
        "Couldn't verify email: user hasn't confirmed it on Facebook or has used mobile phone number for sign in."
      )
    }

    return userEmail === userInfo.email
  }

  _configureResponses() {
    const { http, _transformResponse } = this
    const { response } = http.interceptors

    response.use(_transformResponse, exception => this._exceptionInterceptor(exception))
  }

  _transformResponse(response) {
    return get(response, 'data', {})
  }

  _exceptionInterceptor(exception) {
    const { response, message } = exception

    if (response && isPlainObject(response.data)) {
      const graphResponse = this._transformResponse(response)
      const { message: graphMessage } = get(graphResponse, 'error', {})

      exception.message = graphMessage || message
      exception.response = graphResponse
    } else {
      delete exception.response
    }

    throw exception
  }
}

export default new FacebookVerifier(Config, Axios.create, logger.child({ from: 'FacebookVerifier' }))

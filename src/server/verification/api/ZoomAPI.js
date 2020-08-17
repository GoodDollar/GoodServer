// @flow

import Axios from 'axios'
import { URL } from 'url'
import { assign, merge, get, pick, omit, isPlainObject, isArray, mapValues, once, filter } from 'lodash'

import Config from '../../server.config'
import logger from '../../../imports/logger'

const LIVENESS_PASSED = 0

class ZoomAPI {
  http = null
  defaultMinimalMatchLevel = null

  constructor(Config, httpFactory, logger) {
    const { zoomMinimalMatchLevel } = Config
    const httpClientOptions = this._configureClient(Config, logger)

    this.logger = logger
    this.http = httpFactory(httpClientOptions)
    this.defaultMinimalMatchLevel = Number(zoomMinimalMatchLevel)

    this._configureRequests()
    this._configureResponses()
  }

  async getSessionToken(customLogger = null) {
    let [response, exception] = await this._sendRequest('get', '/session-token', { customLogger })

    if (!exception && !get(response, 'sessionToken')) {
      exception = new Error('No sessionToken in the FaceTec API response')
      assign(exception, { response })
    }

    if (exception) {
      throw exception
    }

    return response
  }

  async submitEnrollment(payload, customLogger = null) {
    let [response, exception] = await this._sendRequest('post', '/enrollment', payload, { customLogger })
    const { message, isEnrolled } = response
    const [isLivenessPassed, reasonOfFailure] = this._checkLivenessStatus(response)

    if (exception || !isLivenessPassed || !isEnrolled) {
      if (/enrollment\s+already\s+exists/i.test(message)) {
        response.subCode = 'nameCollision'
      }

      if (!exception) {
        exception = new Error(reasonOfFailure)
      }

      assign(exception, { response, message: reasonOfFailure })
      throw exception
    }

    return response
  }

  // eslint-disable-next-line require-await
  async readEnrollment(enrollmentIdentifier, customLogger = null) {
    return this._faceMapRequest('get', enrollmentIdentifier, customLogger)
  }

  // eslint-disable-next-line require-await
  async disposeEnrollment(enrollmentIdentifier, customLogger = null) {
    return this._faceMapRequest('delete', enrollmentIdentifier, customLogger)
  }

  async faceSearch(payload, minimalMatchLevel: number = null, customLogger = null) {
    let minMatchLevel = minimalMatchLevel
    let [response, exception] = await this._sendRequest('post', '/search', payload, { customLogger })

    if (exception) {
      let livenessCheckFailed = false

      if ('livenessStatus' in response) {
        const [isLivenessPassed, reasonOfFailure] = this._checkLivenessStatus(response)

        livenessCheckFailed = !isLivenessPassed

        if (livenessCheckFailed) {
          exception.message = reasonOfFailure
        }
      } else {
        livenessCheckFailed = /must\s+have.+?liveness\s+proven/i.test(response.message)
      }

      if (livenessCheckFailed) {
        response.subCode = 'livenessCheckFailed'
      }

      throw exception
    }

    if (null === minMatchLevel) {
      minMatchLevel = this.defaultMinimalMatchLevel
    }

    if (minMatchLevel) {
      const { results = [] } = response
      minMatchLevel = Number(minMatchLevel)

      response.results = results.filter(({ matchLevel }) => Number(matchLevel) >= minMatchLevel)
    }

    return response
  }

  isLivenessCheckPassed(response) {
    const { livenessStatus } = response

    return LIVENESS_PASSED === livenessStatus
  }

  _configureClient(Config, logger) {
    const { zoomLicenseKey, zoomServerBaseUrl } = Config
    const serverURL = new URL(zoomServerBaseUrl)
    const { username, password } = serverURL

    let httpClientOptions = {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        'X-Device-License-Key': zoomLicenseKey
      }
    }

    // passing basic auth via url isn't recommended
    // so we're removing them from the url string
    // and passing via Authorization headers
    if (username || password) {
      httpClientOptions = {
        ...httpClientOptions,
        auth: { username, password }
      }

      serverURL.username = ''
      serverURL.password = ''
    }

    httpClientOptions = {
      ...httpClientOptions,
      baseURL: serverURL.toString()
    }

    logger.debug('Initialized Zoom API client with the options:', httpClientOptions)
    return httpClientOptions
  }

  _configureRequests() {
    const { request } = this.http.interceptors

    request.use(request => {
      const { url, params } = request
      let searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || {})

      const substituteParameter = (_, parameter) => {
        const parameterValue = searchParams.get(parameter) || ''

        searchParams.delete(parameter)
        return encodeURIComponent(parameterValue)
      }

      this._logRequest(request)

      return {
        ...request,
        params: searchParams,
        url: (url || '').replace(/:(\w[\w\d]+)/g, substituteParameter)
      }
    })
  }

  _configureResponses() {
    const { response } = this.http.interceptors

    response.use(
      async response => this._responseInterceptor(response),
      async exception => this._exceptionInterceptor(exception)
    )
  }

  async _responseInterceptor(response) {
    const transformedResponse = this._transformResponse(response)
    const { ok, message, code } = transformedResponse

    this._logResponse('Received response from Zoom API:', response)

    if (false === ok || 200 !== code) {
      const exception = new Error(message || 'FaceTec API response is empty')

      exception.response = transformedResponse
      throw exception
    }

    return transformedResponse
  }

  async _exceptionInterceptor(exception) {
    const { response, message } = exception

    if (response && isPlainObject(response.data)) {
      this._logResponse('Zoom API exception:', response)

      const zoomResponse = this._transformResponse(response)
      const { message: zoomMessage } = zoomResponse

      exception.message = zoomMessage || message
      exception.response = zoomResponse
    } else {
      this._logUnexpectedExecption(exception)

      delete exception.response
    }

    throw exception
  }

  _transformResponse(response) {
    return merge(...Object.values(pick(response.data, 'meta', 'data')))
  }

  _logRequest(request) {
    const requestCopy = pick(request, 'url', 'method', 'headers', 'params')
    const { data, customLogger } = request
    const logger = customLogger || this.logger

    requestCopy.data = this._createLoggingSafeCopy(data)
    logger.debug('Calling Zoom API:', requestCopy)
  }

  _logResponse(logMessage, response) {
    const { data, config } = response
    const logger = config.customLogger || this.logger

    logger.debug(logMessage, this._createLoggingSafeCopy(data))
  }

  _logUnexpectedExecption(exception) {
    const { logger } = this
    const { response, message } = exception

    if (response) {
      const { data, status, statusText, config } = response
      const log = config.customLogger || logger

      log.debug('HTTP exception during Zoom API call:', { data, status, statusText })
    } else {
      logger.debug('Unexpected exception during Zoom API call:', message)
    }
  }

  _createLoggingSafeCopy(payload) {
    if (isArray(payload)) {
      return payload.map(item => this._createLoggingSafeCopy(item))
    }

    if (!isPlainObject(payload)) {
      return payload
    }

    return mapValues(omit(payload, 'faceMap', 'auditTrailImage', 'lowQualityAuditTrailImage'), payloadField =>
      this._createLoggingSafeCopy(payloadField)
    )
  }

  async _sendRequest(method, endpoint, payloadOrOptions = null, options = null) {
    let response
    let exception

    try {
      response = await this.http[method](...filter([endpoint, payloadOrOptions, options]))
    } catch (apiException) {
      exception = apiException
      response = apiException.response

      if (!response) {
        throw apiException
      }
    }

    return [response, exception]
  }

  async _faceMapRequest(method, enrollmentIdentifier, customLogger = null) {
    let [response, exception] = await this._sendRequest(method, '/enrollment/:enrollmentIdentifier', {
      customLogger,
      params: { enrollmentIdentifier }
    })

    const { message } = response

    if (/no\s+entry\s+found/i.test(message)) {
      if (!exception) {
        exception = new Error(message)
        exception.response = response
      }

      response.subCode = 'facemapNotFound'
    }

    if (exception) {
      throw exception
    }

    return response
  }

  _checkLivenessStatus(response) {
    const { glasses, message, isLowQuality } = response
    const isLivenessPassed = this.isLivenessCheckPassed(response)

    let errorMessage = null

    if (!isLivenessPassed) {
      errorMessage = message

      if (isLowQuality || glasses) {
        errorMessage = 'Liveness could not be determined because '

        if (isLowQuality) {
          errorMessage += 'the photoshoots evaluated to be of poor quality.'
        } else if (glasses) {
          errorMessage += 'wearing glasses were detected.'
        }
      }
    }

    return [isLivenessPassed, errorMessage]
  }
}

export default once(() => new ZoomAPI(Config, Axios.create, logger.child({ from: 'ZoomAPI' })))

// @flow

import Axios from 'axios'
import { merge, pick, omit, isPlainObject, isArray, mapValues } from 'lodash'

import Config from '../../server.config'
import logger from '../../../imports/logger'

const log = logger.child({ from: 'ZoomAPI' })

const LIVENESS_PASSED = 0

class ZoomAPI {
  http = null
  defaultMinimalMatchLevel = null

  constructor(Config, httpFactory) {
    const { zoomLicenseKey, zoomServerBaseUrl, zoomMinimalMatchLevel } = Config

    this.http = httpFactory({
      baseURL: zoomServerBaseUrl,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        'X-Device-License-Key': zoomLicenseKey
      }
    })

    this._configureRequests()
    this._configureResponses()
    this.defaultMinimalMatchLevel = Number(zoomMinimalMatchLevel)
  }

  async submitEnrollment(payload, customLogger = null) {
    const response = await this.http.post('/enrollment', payload, { customLogger })
    const { code, glasses, message, isLowQuality, isEnrolled } = response
    const isLivenessPassed = this.checkLivenessStatus(response)

    if (200 !== code || !isLivenessPassed || !isEnrolled) {
      let errorMessage = message

      if (!isLivenessPassed && (isLowQuality || glasses)) {
        errorMessage = 'Liveness could not be determined because '

        if (isLowQuality) {
          errorMessage += 'the photoshoots evaluated to be of poor quality.'
        } else if (glasses) {
          errorMessage += 'wearing glasses were detected.'
        }
      }

      const exception = new Error(errorMessage)

      exception.response = response
      throw exception
    }

    return response
  }

  async readEnrollment(enrollmentIdentifier, customLogger = null) {
    return this.http.get('/enrollment/:enrollmentIdentifier', { customLogger, params: { enrollmentIdentifier } })
  }

  async disposeEnrollment(enrollmentIdentifier, customLogger = null) {
    const response = await this.http.delete('/enrollment/:enrollmentIdentifier', {
      customLogger,
      params: { enrollmentIdentifier }
    })

    const { code, message } = response

    if (200 !== code || message.includes('No entry found')) {
      const exception = new Error(message)

      response.subCode = 'facemapNotFound'
      exception.response = response
      throw exception
    }

    return response
  }

  async faceSearch(payload, minimalMatchLevel: number = null, customLogger = null) {
    const { http, defaultMinimalMatchLevel } = this
    const response = await http.post('/search', payload, { customLogger })
    let minMatchLevel = minimalMatchLevel

    if (null === minMatchLevel) {
      minMatchLevel = defaultMinimalMatchLevel
    }

    if (minMatchLevel) {
      const { results } = response
      minMatchLevel = Number(minMatchLevel)

      response.results = results.filter(({ matchLevel }) => Number(matchLevel) >= minMatchLevel)
    }

    return response
  }

  checkLivenessStatus(response) {
    return LIVENESS_PASSED === response.livenessStatus
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

    response.use(response => this._responseInterceptor(response), exception => this._exceptionInterceptor(exception))
  }

  _responseInterceptor(response) {
    this._logResponse('Received response from Zoom API:', response)

    return this._transformResponse(response)
  }

  _exceptionInterceptor(exception) {
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
    const logger = customLogger || log

    requestCopy.data = this._createLoggingSafeCopy(data)
    logger.debug('Calling Zoom API:', requestCopy)
  }

  _logResponse(logMessage, response) {
    const { data, config } = response
    const logger = config.customLogger || log

    logger.debug(logMessage, this._createLoggingSafeCopy(data))
  }

  _logUnexpectedExecption(exception) {
    const { response, message } = exception

    if (response) {
      log.debug('HTTP exception during Zoom API call:', pick(response, 'data', 'status', 'statusText'))
    } else {
      log.debug('Unexpected exception during Zoom API call:', message)
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
}

export default new ZoomAPI(Config, Axios.create)

// @flow

import Axios from 'axios'
import { merge, pick, isPlainObject } from 'lodash'

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

  async submitEnrollment(payload) {
    const response = await this.http.post('/enrollment', payload)
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

  async readEnrollment(enrollmentIdentifier) {
    return this.http.get('/enrollment/:enrollmentIdentifier', { params: { enrollmentIdentifier } })
  }

  async disposeEnrollment(enrollmentIdentifier) {
    const response = await this.http.delete('/enrollment/:enrollmentIdentifier', { params: { enrollmentIdentifier } })

    const { code, message } = response

    if (200 !== code || message.includes('No entry found')) {
      const exception = new Error(message)

      response.subCode = 'facemapNotFound'
      exception.response = response
      throw exception
    }

    return response
  }

  async faceSearch(payload, minimalMatchLevel: number = null) {
    const { http, defaultMinimalMatchLevel } = this
    const response = await http.post('/search', payload)
    console.log({ response })
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

    request.use(config => {
      const { url, params } = config
      let searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || {})

      const substituteParameter = (_, parameter) => {
        const parameterValue = searchParams.get(parameter) || ''

        searchParams.delete(parameter)
        return encodeURIComponent(parameterValue)
      }

      log.debug('Calling Zoom API:', config)

      return {
        ...config,
        params: searchParams,
        url: (url || '').replace(/:(\w[\w\d]*?)/g, substituteParameter)
      }
    })
  }

  _configureResponses() {
    const { response } = this.http.interceptors

    response.use(response => this._responseInterceptor(response), exception => this._exceptionInterceptor(exception))
  }

  _responseTransformer(response) {
    const { data } = response

    return merge(...Object.values(pick(data, 'meta', 'data')))
  }

  _responseInterceptor(response) {
    log('Received response from Zoom API:', response)

    return this.transformedResponse(response)
  }

  _exceptionInterceptor(exception) {
    const { response, message } = exception

    if (response && isPlainObject(response.data)) {
      log.debug('Zoom API exception:', response.data)

      const zoomResponse = this._responseTransformer(response)
      const { message: zoomMessage } = zoomResponse

      exception.message = zoomMessage || message
      exception.response = zoomResponse
    } else {
      if (response) {
        log.debug('HTTP exception during Zoom API call:', pick(response, 'data', 'status', 'statusText'))
      } else {
        log.debug('Unexpected exception during Zoom API call:', message)
      }

      delete exception.response
    }

    throw exception
  }
}

export default new ZoomAPI(Config, Axios.create)

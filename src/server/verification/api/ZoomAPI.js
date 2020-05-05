// @flow

import Axios from 'axios'
import { merge, pick, isPlainObject } from 'lodash'

import Config from '../../server.config'

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

  async detectLiveness(payload) {
    const response = await this.http.post('/liveness', payload)

    this._checkLivenessStatus(response)
    return response
  }

  async submitEnrollment(payload) {
    const response = await this.http.post('/enrollment', payload)
    const { code, message, isEnrolled } = response

    this._checkLivenessStatus(response)

    if (200 !== code || !isEnrolled) {
      const exception = new Error(message)

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

  _checkLivenessStatus(response) {
    const { code, glasses, message, livenessStatus, isLowQuality } = response

    if (200 !== code || LIVENESS_PASSED !== livenessStatus) {
      let errorMessage = 'Liveness could not be determined because '

      if (isLowQuality) {
        errorMessage += 'the photoshoots evaluated to be of poor quality.'
      } else if (glasses) {
        errorMessage += 'wearing glasses were detected.'
      } else {
        errorMessage = message
      }

      const exception = new Error(errorMessage)

      exception.response = response
      throw exception
    }
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

      return {
        ...config,
        params: searchParams,
        url: (url || '').replace(/:(\w[\w\d]*?)/g, substituteParameter)
      }
    })
  }

  _configureResponses() {
    const { response } = this.http.interceptors
    const responseInterceptor = ({ data }) => merge(...Object.values(pick(data, 'meta', 'data')))

    response.use(responseInterceptor, async exception => {
      const { response, message } = exception

      if (response && isPlainObject(response.data)) {
        const zoomResponse = responseInterceptor(response)
        const { message: zoomMessage } = zoomResponse

        exception.message = zoomMessage || message
        exception.response = zoomResponse
      } else {
        delete exception.response
      }

      throw exception
    })
  }
}

export default new ZoomAPI(Config, Axios.create)

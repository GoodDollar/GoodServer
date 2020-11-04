// @flow

import Axios from 'axios'
import { URL } from 'url'
import { assign, get, pick, omit, isPlainObject, isArray, mapValues, once, lowerFirst } from 'lodash'

import Config from '../../server.config'
import logger from '../../../imports/logger'

export const ZoomAPIError = {
  FacemapNotFound: 'facemapNotFound',
  LivenessCheckFailed: 'livenessCheckFailed',
  SecurityCheckFailed: 'securityCheckFailed',
  NameCollision: 'nameCollision'
}

export const failedEnrollmentMessage = 'FaceMap could not be enrolled'
export const failedLivenessMessage = 'Liveness could not be determined'
export const enrollmentNotFoundMessage = 'An enrollment does not exists for this enrollment identifier'
export const enrollmentAlreadyExistsMessage = 'An enrollment already exists for this enrollment identifier'

export const faceSnapshotFields = ['sessionId', 'faceScan', 'auditTrailImage', 'lowQualityAuditTrailImage']
const redactFieldsDuringLogging = ['faceMapBase64', 'auditTrailBase64', ...faceSnapshotFields]

class ZoomAPI {
  http = null
  defaultMinimalMatchLevel = null
  defaultSearchIndexName = null

  constructor(Config, httpFactory, logger) {
    const { zoomMinimalMatchLevel, zoomSearchIndexName } = Config
    const httpClientOptions = this._configureClient(Config, logger)

    this.logger = logger
    this.http = httpFactory(httpClientOptions)
    this.defaultMinimalMatchLevel = Number(zoomMinimalMatchLevel)
    this.defaultSearchIndexName = zoomSearchIndexName

    this._configureRequests()
    this._configureResponses()
  }

  async getSessionToken(customLogger = null) {
    const response = await this.http.get('/session-token', { customLogger })

    if (!get(response, 'sessionToken')) {
      const exception = new Error('No sessionToken in the FaceTec API response')

      assign(exception, { response })
      throw exception
    }

    return response
  }

  async readEnrollment(enrollmentIdentifier, customLogger = null) {
    let response

    try {
      response = await this.http.get('/enrollment-3d/:enrollmentIdentifier', {
        customLogger,
        params: { enrollmentIdentifier }
      })
    } catch (exception) {
      const { message } = exception

      if (/no\s+entry\s+found/i.test(message)) {
        assign(exception, {
          name: ZoomAPIError.FacemapNotFound,
          message: enrollmentNotFoundMessage
        })
      }

      throw exception
    }

    return response
  }

  async checkLiveness(payload, customLogger = null) {
    let response

    try {
      response = await this._faceScanRequest('liveness', payload, null, customLogger)
    } catch (exception) {
      const { name, message } = exception

      if (ZoomAPIError.SecurityCheckFailed === name) {
        exception.message = failedLivenessMessage + ' because the ' + lowerFirst(message)
      }

      throw exception
    }

    return response
  }

  async submitEnrollment(enrollmentIdentifier, payload, customLogger = null) {
    let response
    const additionalData = { externalDatabaseRefID: enrollmentIdentifier }

    try {
      response = await this._faceScanRequest('enrollment', payload, additionalData, customLogger)
    } catch (exception) {
      let { name, message } = exception
      const { NameCollision, SecurityCheckFailed } = ZoomAPIError

      if (SecurityCheckFailed === name) {
        message = failedEnrollmentMessage + ' because the ' + lowerFirst(message)
      } else if (/enrollment\s+already\s+exists/i.test(message)) {
        name = NameCollision
        message = enrollmentAlreadyExistsMessage
      }

      assign(exception, { name, message })
      throw exception
    }

    return response
  }

  // eslint-disable-line require-await
  async indexEnrollment(enrollmentIdentifier, indexName = null, customLogger = null) {
    return this._3dDbRequest('enroll', enrollmentIdentifier, indexName, null, customLogger)
  }

  // eslint-disable-next-line require-await
  async readEnrollmentIndex(enrollmentIdentifier, indexName = null, customLogger = null) {
    return this._3dDbIndexRequest('get', enrollmentIdentifier, indexName, customLogger)
  }

  // eslint-disable-next-line require-await
  async removeEnrollmentFromIndex(enrollmentIdentifier, indexName = null, customLogger = null) {
    return this._3dDbIndexRequest('delete', enrollmentIdentifier, indexName, customLogger)
  }

  async faceSearch(enrollmentIdentifier, minimalMatchLevel: number = null, indexName = null, customLogger = null) {
    let minMatchLevel = minimalMatchLevel
    let response

    if (null === minMatchLevel) {
      minMatchLevel = this.defaultMinimalMatchLevel
    }

    try {
      response = await this._3dDbRequest('search', enrollmentIdentifier, indexName, { minMatchLevel }, customLogger)
    } catch (exception) {
      // checking is the reason of error is index wasn't initialized yet
      // that means there just no enrollment were added

      // for some other kind of reason re-throwing an exception
      if (!/groupName\s+does\s+not\s+exist/i.test(exception.message)) {
        throw exception
      }

      // if it's because empty, non-initialized index - will
      // ignore the error an return empty results
      response = {
        success: true,
        error: false,
        results: []
      }
    }

    return response
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
    const zoomResponse = this._transformResponse(response)
    const { error, errorMessage } = zoomResponse

    this._logResponse('Received response from Zoom API:', response)

    if (true === error) {
      const exception = new Error(errorMessage || 'FaceTec API response is empty')

      exception.response = zoomResponse
      throw exception
    }

    return zoomResponse
  }

  async _exceptionInterceptor(exception) {
    const { response, message } = exception

    if (response && isPlainObject(response.data)) {
      this._logResponse('Zoom API exception:', response)

      const zoomResponse = this._transformResponse(response)
      const { errorMessage: zoomMessage } = zoomResponse

      exception.message = zoomMessage || message
      exception.response = zoomResponse
    } else {
      this._logUnexpectedExecption(exception)

      delete exception.response
    }

    throw exception
  }

  _transformResponse(response) {
    return get(response, 'data', {})
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

  _getDatabaseIndex(indexName = null) {
    let databaseIndex = indexName

    if (null === indexName) {
      databaseIndex = this.defaultSearchIndexName
    }

    return databaseIndex
  }

  async _faceScanRequest(operation, payload, additionalData = null, customLogger = null) {
    const payloadData = {
      ...pick(payload, faceSnapshotFields),
      ...(additionalData || {})
    }

    const response = await this.http.post(`/${operation}-3d`, payloadData, { customLogger })
    const { LivenessCheckFailed, SecurityCheckFailed } = ZoomAPIError
    const { success, faceScanSecurityChecks } = response

    const {
      faceScanLivenessCheckSucceeded,
      auditTrailVerificationCheckSucceeded,
      replayCheckSucceeded,
      sessionTokenCheckSucceeded
    } = faceScanSecurityChecks

    if (!success) {
      let message = `Unknown exception happened during ${operation} request`

      if (!sessionTokenCheckSucceeded) {
        message = 'Session token is missing or was failed to be checked'
      } else if (!replayCheckSucceeded) {
        message = 'Replay check was failed'
      } else if (!faceScanLivenessCheckSucceeded) {
        message = failedLivenessMessage

        if (!auditTrailVerificationCheckSucceeded) {
          message += ' because the photoshoots evaluated to be of poor quality'
        }
      }

      const exception = new Error(message)

      if (!sessionTokenCheckSucceeded || !replayCheckSucceeded) {
        exception.name = SecurityCheckFailed
      } else if (!faceScanLivenessCheckSucceeded) {
        exception.name = LivenessCheckFailed
      }

      assign(exception, { response })
      throw exception
    }

    return response
  }

  async _3dDbRequest(operation, enrollmentIdentifier, indexName = null, additionalData = null, customLogger = null) {
    let response
    const databaseIndex = this._getDatabaseIndex(indexName)

    const payload = {
      externalDatabaseRefID: enrollmentIdentifier,
      groupName: databaseIndex,
      ...(additionalData || {})
    }

    try {
      response = await this.http.post(`/3d-db/${operation}`, payload, { customLogger })
    } catch (exception) {
      const { message } = exception

      if (/enrollment\s+does\s+not\s+exist/i.test(message)) {
        assign(exception, {
          message: enrollmentNotFoundMessage,
          name: ZoomAPIError.FacemapNotFound
        })
      }

      throw exception
    }

    return response
  }

  async _3dDbIndexRequest(method, enrollmentIdentifier, indexName = null, customLogger = null) {
    const databaseIndex = this._getDatabaseIndex(indexName)

    const payload = {
      identifier: enrollmentIdentifier,
      groupName: databaseIndex
    }

    const response = await this.http.post(`/3d-db/${method}`, payload, { customLogger })
    const { success } = response

    if (false === success) {
      const exception = new Error(enrollmentNotFoundMessage)

      assign(exception, { response, name: ZoomAPIError.FacemapNotFound })
      throw exception
    }

    return response
  }

  _createLoggingSafeCopy(payload) {
    if (isArray(payload)) {
      return payload.map(item => this._createLoggingSafeCopy(item))
    }

    if (!isPlainObject(payload)) {
      return payload
    }

    return mapValues(omit(payload, redactFieldsDuringLogging), payloadField =>
      this._createLoggingSafeCopy(payloadField)
    )
  }
}

export default once(() => new ZoomAPI(Config, Axios.create, logger.child({ from: 'ZoomAPI' })))

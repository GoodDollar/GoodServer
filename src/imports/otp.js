// @flow
import random from 'math-random'
import jwt from 'jsonwebtoken'
import Axios from 'axios'
import requestIp from 'request-ip'
import { get } from 'lodash'

import conf from '../server/server.config'
import logger from './logger'

export default new (class {
  constructor(Config, jwt, Axios, logger) {
    const { cfWorkerVerifyJwtSecret, cfWorkerVerifyJwtAudience, cfWorkerVerifyJwtSubject, cfWorkerVerifyUrl } = Config

    this.log = logger

    if (!cfWorkerVerifyJwtSecret || !cfWorkerVerifyJwtAudience || !cfWorkerVerifyJwtSubject || !cfWorkerVerifyUrl) {
      this.log.warn('missing cloudflare worker JWT configuration')
      return
    }

    this.jwt = jwt
    this.jwtSecret = cfWorkerVerifyJwtSecret
    this.jwtAudience = cfWorkerVerifyJwtAudience
    this.jwtSubject = cfWorkerVerifyJwtSubject
    this.verifyWorkerUrl = cfWorkerVerifyUrl

    this.http = Axios.create(this.getHttpOptions())
  }

  extractIP(req) {
    const clientIp = requestIp.getClientIp(req)
    return clientIp
  }

  getExceptionText(exception) {
    const text = get(exception, 'response.data.text', null)
    if (text) {
      exception.message = exception.message + ' ' + text
    }
    return exception
  }

  getHttpOptions() {
    const httpClientOptions = {
      baseURL: this.verifyWorkerUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.generateJWT()
      }
    }
    return httpClientOptions
  }
  /**
   * Creates an OTP code and returns it as a string
   * @param {number} length - length of OTP code
   * @returns {string}
   */
  generateOTP(length: number = 0): string {
    const exponent = length - 1
    const base = Number(`1e${exponent}`)
    const multiplier = Number(`9e${exponent}`)

    return Math.floor(base + random() * multiplier).toString()
  }

  /**
   * Generates and sends an OTP code to the user's mobile number
   * @param {string} mobile - user's mobile
   * @param {string} channel - 'sms' or 'call' - currently handled automatically by cloudflare worker
   * @param {Request} request - express request object
   * @returns {Promise<object>}
   */
  async sendOTP(mobile, channel, request): Promise<object> {
    const { log } = this
    //currently chaeel
    const payload = { recipient: mobile, verify: true, req: { ip: this.extractIP(request) } }

    try {
      const result = await this.http.post(this.verifyWorkerUrl, payload)
      return result.data
    } catch (exception) {
      const { message } = exception
      const logFunc = message === 'Max send attempts reached' ? 'warn' : 'error'

      this.getExceptionText(exception)

      log[logFunc]('Error sending OTP:', message, exception, { mobile })
      throw exception
    }
  }

  /**
   * Checks OTP code sent to the user's mobile number
   * @param {string} mobile - user's mobile
   * @param {string} code - code to be verified by cloudflare worker
   * @returns {Promise<object>}
   */
  async checkOTP(mobile, code: string, clientIp): Promise<object> {
    const { log } = this
    const payload = { recipient: mobile, code, verify: true, req: { ip: clientIp } }

    try {
      const result = await this.http.post(this.verifyWorkerUrl, payload)
      return result.data
    } catch (exception) {
      const { message } = exception

      this.getExceptionText(exception)
      log.error('Error verification OTP:', message, exception, { mobile, code })
      throw exception
    }
  }

  generateJWT() {
    const token = this.jwt.sign({ foo: 'bar' }, this.jwtSecret, {
      audience: this.jwtAudience,
      subject: this.jwtSubject
    })
    return token
  }
})(conf, jwt, Axios, logger.child({ from: 'Twilio' }))

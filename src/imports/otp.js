// @flow
import random from 'math-random'
import jwt from 'jsonwebtoken'
import Axios from 'axios'
import axiosRetry from 'axios-retry'
import { get, isError } from 'lodash'

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
    this.http = this.createHttpClient(Axios, Config)
  }

  createHttpClient(Axios, Config) {
    const { otpRetryAttempts, otpRetryDelay } = Config

    const http = Axios.create({
      baseURL: this.verifyWorkerUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    http.interceptors.request.use(config => {
      config.headers.Authorization = 'Bearer ' + this.generateJWT()
      return config
    })
    axiosRetry(http, {
      retries: otpRetryAttempts,
      retryDelay: count => otpRetryDelay * 2 ** count,
      retryCondition: reason => isError(reason) && 429 === get(reason, 'response.status')
    })

    return http
  }

  getExceptionText(exception) {
    const text = get(exception, 'response.data.text', null)

    if (text) {
      exception.message = exception.message + ' ' + text
    }

    return exception
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
  async sendOTP(mobile, channel, clientIp): Promise<object> {
    const { log } = this
    //currently chaeel
    const payload = { recipient: mobile, verify: true, req: { ip: clientIp } }

    try {
      const result = await this.http.post(this.verifyWorkerUrl, payload)
      return result.data
    } catch (exception) {
      const { message } = exception

      this.getExceptionText(exception)

      log.warn('Error sending OTP:', message, exception, { mobile })
      throw exception
    }
  }

  async verifyCaptcha(clientIp, captchaType): Promise<object> {
    const { log } = this
    const payload = { captcha: true, verify: true, captchaType, req: { ip: clientIp } }

    try {
      const result = await this.http.post(this.verifyWorkerUrl, payload)
      return result.data
    } catch (exception) {
      const { message } = exception

      this.getExceptionText(exception)

      log.warn('Error verifying captcha:', message, exception, { clientIp })
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
      log.warn('Error verification OTP:', message, exception, { mobile, code })
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

// @flow
import random from 'math-random'
import Twilio from 'twilio'

import conf from '../server/server.config'
import logger from './logger'
import type { UserRecord } from './types'

export default new (class {
  constructor(Config, Twilio, logger) {
    const { twilioAuthID, twilioAuthToken, twilioVerifyID } = Config
    const { services } = Twilio(twilioAuthID, twilioAuthToken).verify

    this.log = logger
    this.service = services(twilioVerifyID)
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
   * @param {UserRecord} user - object with user's information
   * @param {object} options - options used to config the method behavior
   * @returns {Promise<object>}
   */
  async sendOTP(user: UserRecord, options: any = {}): Promise<object> {
    const { channel = 'sms' } = options
    const { mobile } = user
    const { log, service } = this
    const payload = { to: mobile, channel }

    try {
      return await service.verifications.create(payload)
    } catch (exception) {
      const { message } = exception

      log.error('Error sending OTP:', message, exception, { mobile })
      throw exception
    }
  }

  /**
   * Checks OTP code sent to the user's mobile number
   * @param {UserRecord} user - object with user's information
   * @returns {Promise<object>}
   */
  async checkOTP(user: UserRecord, code: string): Promise<object> {
    const { mobile } = user
    const { log, service } = this
    const options = { to: mobile, code }

    try {
      return await service.verificationChecks.create(options)
    } catch (exception) {
      const { message } = exception

      log.error('Error verification OTP:', message, exception, { mobile, code })
      throw exception
    }
  }
})(conf, Twilio, logger.child({ from: 'Twilio' }))

// @flow
import random from 'math-random'
import Twilio from 'twilio'

import conf from '../server/server.config'
import type { UserRecord } from './types'

/**
 * Creates an OTP code and returns it as a string
 * @param {number} length - length of OTP code
 * @returns {string}
 */
export const generateOTP = (length: number = 0): string => {
  const exponent = length - 1
  const base = Number(`1e${exponent}`)
  const multiplier = Number(`9e${exponent}`)

  return Math.floor(base + random() * multiplier).toString()
}

export default new (class {
  constructor(Config, Twilio) {
    const { twilioAuthID, twilioAuthToken, twilioVerifyID, otpDigits } = Config

    this.client = Twilio(twilioAuthID, twilioAuthToken)
    this.options = { friendlyName: 'GoodDollar', codeLength: otpDigits }
    this.service = this.client.verify.services(twilioVerifyID)
  }

  /**
   * Generates and sends an OTP code to the user's mobile number
   * @param {UserRecord} user - object with user's information
   * @returns {Promise<void>}
   */
  async sendOTP(user: UserRecord): Promise<void> {
    const options = { to: user.mobile, channel: 'sms' }

    return this.service.verifications.create(options)
  }

  /**
   * Checks OTP code sent to the user's mobile number
   * @param {UserRecord} user - object with user's information
   * @returns {Promise<string>}
   */
  async checkOTP(user: UserRecord, code: string): Promise<boolean> {
    const options = { to: user.mobile, code }
    return this.service.verificationChecks.create(options)
  }
})(conf, Twilio)

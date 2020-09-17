// @flow
import { assign } from 'lodash'
import Twilio from 'twilio'

import conf from '../server/server.config'
import type { UserRecord } from './types'

export default new (class {
  constructor(Config, Twilio) {
    const { twilioAuthID, twilioAuthToken, otpDigits } = Config

    this.client = Twilio(twilioAuthID, twilioAuthToken)
    this.options = { friendlyName: 'GoodDollar', codeLength: otpDigits }
  }

  /**
   * Generates and sends an OTP code to the user's mobile number
   * @param {UserRecord} user - object with user's information
   * @returns {Promise<void>}
   */
  async sendOTP(user: UserRecord): Promise<void> {
    const options = { to: user.mobile, channel: 'sms' }

    await this.exec(service => service.verifications.create(options))
  }

  /**
   * Checks OTP code sent to the user's mobile number
   * @param {UserRecord} user - object with user's information
   * @returns {Promise<string>}
   */
  async checkOTP(user: UserRecord, code: string): Promise<boolean> {
    const options = { to: user.mobile, code }

    return this.exec(service => service.verificationChecks.create(options))
  }

  /**
   * @private
   */
  async exec(serviceCall) {
    let { client, options, service } = this
    const { services } = client.verify

    if (!service) {
      const { sid } = await services.create(options)

      service = services(sid)
      assign(this, { service })
    }

    return serviceCall(service)
  }
})(conf, Twilio)

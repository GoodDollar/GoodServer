// @flow
import type { UserRecord, VerificationAPI } from '../../imports/types'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import OTP from '../../imports/otp'
import logger from '../../imports/logger'
import { timeout } from '../utils/timeout'

/**
 * Verifications class implements `VerificationAPI`
 * Used to verify user, email and mobile phone.
 */
class Verifications implements VerificationAPI {
  log: any

  constructor() {
    this.log = logger.child({ from: 'Verifications' })
  }

  /**
   * Verifies mobile phone
   * @param {UserRecord} user to verify
   * @param {object} verificationData
   * @param {string} verificationData.otp
   * @returns {Promise<boolean | Error>}
   */
  async verifyMobile(user: UserRecord, verificationData: { otp: string }, clientIp): Promise<boolean | Error> {
    let checkResult
    const { log } = this
    const { otp } = verificationData

    log.debug('verifyMobile:', { user, otp })

    if (!otp) {
      throw new Error('No code to validate, please retry')
    }

    try {
      checkResult = await Promise.race([
        OTP.checkOTP(user.mobile, otp, clientIp),
        timeout(5000, 'Not much time since last attempt. Please try again later')
      ])
    } catch (e) {
      let exception = e

      if (e.code === 60202) {
        exception = new Error('You have failed 5 verification attempts. Please go back and try again in 10 minutes')
      }

      throw exception
    }

    const { status } = checkResult

    log.debug('verifyMobile result:', { checkResult, user, otp })

    if ('canceled' === status) {
      throw new Error('Code expired, please retry')
    }

    if ('approved' !== status) {
      throw new Error("Oops, it's not right code")
    }

    return true
  }

  /**
   * Verifies a user's email using its profile and the verification code
   * @param {UserRecord} user - User profile
   * @param {object} verificationData - object sent by the client with required verification data
   * @param {string} verificationData.code - code used to verify that the email is valid
   * @returns {Promise<boolean|Error>}
   */
  async verifyEmail(user: UserRecord, verificationData: { code: string }): Promise<boolean | Error> {
    const code = await UserDBPrivate.getUserField(user.identifier, 'emailVerificationCode')

    if (!code) {
      throw new Error('No code to validate, retry')
    }

    this.log.info({ verificationData, code })

    if (String(verificationData.code) !== String(code)) {
      throw new Error("Oops, it's not right code")
    }

    return true
  }
}

export default new Verifications()

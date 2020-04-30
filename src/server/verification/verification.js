// @flow
import type { UserRecord, VerificationAPI } from '../../imports/types'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import logger from '../../imports/logger'

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
  async verifyMobile(user: UserRecord, verificationData: { otp: string }): Promise<boolean | Error> {
    const otp = await UserDBPrivate.getUserField(user.identifier, 'otp')

    this.log.debug('verifyMobile:', { userId: user.identifier, otp })

    if (!otp) {
      throw new Error('No code to validate, retry')
    }

    if (String(verificationData.otp) !== String(otp.code)) {
      throw new Error("Oops, it's not right code")
    }

    if (otp.expirationDate <= Date.now()) {
      throw new Error('Code expired, retry')
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

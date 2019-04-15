// @flow
import logger from '../../imports/pino-logger'
import type { UserRecord, VerificationAPI } from '../../imports/types'
import { GunDBPrivate } from '../gun/gun-middleware'

class Verifications implements VerificationAPI {
  log: any

  constructor() {
    this.log = logger.child({ from: 'Verifications' })
  }

  async verifyUser(user: UserRecord, verificationData: any): Promise<boolean> {
    return Promise.resolve(true)
  }

  async verifyMobile(user: UserRecord, verificationData: { otp: string }): Promise<boolean | Error> {
    const otp = await GunDBPrivate.getUserField(user.identifier, 'otp')

    if (otp) {
      if (+verificationData.otp === otp.code) {
        if (otp.expirationDate < Date.now()) {
          return Promise.reject(new Error('Code expired, retry'))
        }
        return Promise.resolve(true)
      }
      return Promise.reject(new Error("Oops, it's not right code"))
    }
    return Promise.reject(new Error('No code to validate, retry'))
  }

  /**
   * Verifies a user's email using its profile and the verification code
   * @param {UserRecord} user - User profile
   * @param {object} verificationData - object sent by the client with required verification data
   * @param {string} verificationData.code - code used to verify that the email is valid
   * @returns {Promise<boolean|Error>}
   */
  async verifyEmail(user: UserRecord, verificationData: { code: string }): Promise<boolean | Error> {
    const code = await GunDBPrivate.getUserField(user.identifier, 'emailVerificationCode')

    if (code) {
      this.log.info({ verificationData, code })
      if (+verificationData.code === code) {
        return Promise.resolve(true)
      }
      return Promise.reject(new Error("Oops, it's not right code"))
    }
    return Promise.reject(new Error('No code to validate, retry'))
  }
}

export default new Verifications()

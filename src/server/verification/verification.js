// @flow
import type { UserRecord, VerificationAPI } from '../../imports/types'
import { GunDBPrivate } from '../gun/gun-middleware'
import Helper, { type EnrollResult, type VerificationData } from './faceRecognition/faceRecognitionHelper'
import logger from '../../imports/pino-logger'

class Verifications implements VerificationAPI {
  log: any

  constructor() {
    this.log = logger.child({ from: 'Verifications' })
  }

  async verifyUser(user: UserRecord, verificationData: any): Promise<boolean> {
    //this.log.debug('Verifying user:', { user, verificationData })
    const livenessData = Helper.prepareLivenessData(verificationData)
    const searchData = Helper.prepareSearchData(verificationData)
    // log.info('searchData', { searchData })
    const [isDuplicate, livenessPassed] = await Promise.all([
      Helper.isDuplicatesExist(searchData, verificationData.enrollmentIdentifier),
      Helper.isLivenessPassed(livenessData)
    ])
    this.log.debug('liveness result:', { user: user.identifier, livenessPassed })
    if (!livenessPassed) return { ok: 1, livenessPassed }
    this.log.debug('isDuplicate result:', { user: user.identifier, isDuplicate })
    if (isDuplicate) return { ok: 1, isDuplicate }
    const enrollData = Helper.prepareEnrollmentData(verificationData)
    // log.info('enrollData', { enrollData })
    const enrollResult: EnrollResult = await Helper.enroll(enrollData)
    const isVerified =
      livenessPassed && !isDuplicate && (enrollResult.alreadyEnrolled || enrollResult.enrollmentIdentifier)
    return {
      ok: 1,
      isVerified,
      enrollResult: { ...enrollResult, enrollmentIdentifier: verificationData.enrollmentIdentifier }
    }
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

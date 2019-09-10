// @flow
import type { UserRecord, VerificationAPI } from '../../imports/types'
import { GunDBPublic } from '../gun/gun-middleware'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import Helper, { type EnrollResult } from './faceRecognition/faceRecognitionHelper'
import logger from '../../imports/pino-logger'

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
   * Verifies user
   * @param {UserRecord} user user details of the user going through FR
   * @param {*} verificationData data from zoomsdk

   */
  async verifyUser(user: UserRecord, verificationData: any) {
    this.log.debug('Verifying user:', { user })
    const sessionId = verificationData.sessionId
    this.log.debug('sessionId:', { sessionId })
    const searchData = Helper.prepareSearchData(verificationData)
    // log.info('searchData', { searchData })
    const isDuplicate = await Helper.isDuplicatesExist(searchData, verificationData.enrollmentIdentifier)
    GunDBPublic.gun
      .get(sessionId)
      .get('isNotDuplicate')
      .put(!isDuplicate) // publish to subscribers

    this.log.debug('isDuplicate result:', { user: user.identifier, isDuplicate })
    if (isDuplicate) return { ok: 1, isDuplicate }
    const enrollData = Helper.prepareEnrollmentData(verificationData)
    // log.info('enrollData', { enrollData })
    const enrollResult: EnrollResult = await Helper.enroll(enrollData)
    GunDBPublic.gun
      .get(sessionId)
      .get('isEnrolled')
      .put(enrollResult.alreadyEnrolled || (enrollResult.enrollmentIdentifier ? true : false)) // publish to subscribers
    const livenessFailed = (enrollResult && enrollResult.ok === false) || enrollResult.livenessResult === 'undetermined'
    this.log.debug('liveness result:', { user: user.identifier, livenessFailed })

    GunDBPublic.gun
      .get(sessionId)
      .get('isLive')
      .put(!livenessFailed) // publish to subscribers
    if (livenessFailed) return { ok: 1, livenessPassed: false }

    //this.log.debug('liveness result:', { user: user.identifier, livenessPassed }) // This is left to support future granularity for user better UX experience. Consider using authenticationFacemapIsLowQuality property https://dev.zoomlogin.com/zoomsdk/#/webservice-guide
    //if (!livenessPassed) return { ok: 1, livenessPassed }

    const isVerified =
      !isDuplicate && (enrollResult.alreadyEnrolled || (enrollResult.enrollmentIdentifier ? true : false)) // enrollResult.enrollmentIdentifier should return true if there is value in it (and not the value itself) into isVerified.
    return {
      ok: 1,
      isVerified,
      enrollResult: { ...enrollResult, enrollmentIdentifier: verificationData.enrollmentIdentifier }
    }
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
    if (otp) {
      if (String(verificationData.otp) === String(otp.code)) {
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
    const code = await UserDBPrivate.getUserField(user.identifier, 'emailVerificationCode')

    if (code) {
      this.log.info({ verificationData, code })
      if (String(verificationData.code) === String(code)) {
        return Promise.resolve(true)
      }
      return Promise.reject(new Error("Oops, it's not right code"))
    }
    return Promise.reject(new Error('No code to validate, retry'))
  }
}

export default new Verifications()

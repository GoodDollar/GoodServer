// @flow
import type { StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import { GunDBPublic } from '../gun/gun-middleware'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import logger from '../../imports/logger'
import humanAPI from './faceRecognition/human'
import AdminWallet from '../blockchain/AdminWallet'
import { pick } from 'lodash'

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
   * @param sessionId
   * @param imagesBase64
   * @param storage

   */
  async verifyUser(user: UserRecord, sessionId: string, imagesBase64: string, storage: StorageAPI) {
    this.log.debug('Verifying user:', { user })

    const enrollHandler = async (userId, sessionId, data) => {
      this.log.debug('Verifying user enrollHandler :', data)
      const sessionRef = GunDBPublic.session(sessionId)
      const enrollPayload = pick(data, 'isDuplicate', 'isLive', 'isEnrolled')

      sessionRef.put(enrollPayload)

      if (data.ok && data.isEnroll) {
        this.log.debug('Whitelisting new user', user)
        try {
          await Promise.all([
            AdminWallet.whitelistUser(user.gdAddress, user.profilePublickey),
            storage
              .updateUser({ identifier: user.loggedInAs, isVerified: true })
              .then(updatedUser => this.log.debug('updatedUser:', updatedUser))
          ])
          sessionRef.put({ isWhitelisted: true })
        } catch (e) {
          this.log.error('Whitelisting failed', e)
          sessionRef.put({ isWhitelisted: false, isError: e.message })
        }
      } else if (!data.ok) {
        sessionRef.put({ isDuplicate: true, isLive: false, isWhitelisted: false, isError: data.error })
      }
    }

    return humanAPI.addIfUniqueAndAlive(user.identifier, sessionId, imagesBase64, enrollHandler)
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

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
    const storedUser = await GunDBPrivate.getUser(user.pubkey)

    if (storedUser && storedUser.otp) {
      if (+verificationData.otp === storedUser.otp.code) {
        if (storedUser.otp.expirationDate < Date.now()) {
          return Promise.reject(new Error('Code expired, retry'))
        }
        return Promise.resolve(true)
      }
      return Promise.reject(new Error("Oops, it's not right code"))
    }
    return Promise.reject(new Error('No code to validate, retry'))
  }
}

export default new Verifications()

import logger from '../../imports/pino-logger'
import type { UserRecord } from '../../imports/types'
import { GunDBPrivate } from '../gun/gun-middleware'

class Verifications {
  log: any

  constructor() {
    this.log = logger.child({ from: 'Verifications' })
  }

  verifyUser = async (user: UserRecord, verificationData: any): Promise<boolean> => Promise.resolve(true)

  verifyMobile = async (user: UserRecord, verificationData: any): Promise<any> => {
    const { expirationDate, otp }: { otp: string, expirationDate: number } = await GunDBPrivate.getOTP(user)

    if (+verificationData.otp === otp) {
      if (expirationDate < Date.now()) {
        return Promise.reject(new Error('Code expired, retry'))
      }
      return Promise.resolve(true)
    }
    return Promise.reject(new Error("Oops, it's not right code"))
  }
}

export default new Verifications()

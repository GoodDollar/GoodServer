import verification from '../verification'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { findFaucetAbuse } from '../../blockchain/explorer'
const emailVerificationCode = 123456

const testUser = {
  identifier: '01',
  fullName: 'mongo_test',
  email: 'test@test.test',
  mobile: '123456789',
  emailVerificationCode
}

describe('verification', () => {
  beforeEach(async () => {
    await UserDBPrivate.model.deleteMany({ fullName: new RegExp('mongo_test', 'i') })
    await UserDBPrivate.addUser(testUser)
  })

  test('verifyUser email true', async () => {
    const code = emailVerificationCode
    const isVerified = await verification.verifyEmail(testUser, { code })

    expect(isVerified).toBeTruthy()
  })

  test('verifyUser email false', async () => {
    const emailVerificationCodeBad = {
      code: 123457
    }

    await expect(verification.verifyEmail(testUser, emailVerificationCodeBad)).rejects.toThrow()
  })

  test.skip('faucet abuse', async () => {
    await expect(findFaucetAbuse('0xDdDfFe17c3A8266D859e0BD299E3e230aa09F3d6', 50)).resolves.not.toThrow()
  })
})

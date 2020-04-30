import verification from '../verification'
import UserDBPrivate from '../../db/mongo/user-privat-provider'

const emailVerificationCode = 123456

const testUser = {
  identifier: '01',
  fullName: 'mongo_test',
  email: 'test@test.test',
  mobile: '123456789',
  emailVerificationCode
}

describe('verification', () => {
  beforeAll(async () => UserDBPrivate.updateUser(testUser))

  afterAll(async () => UserDBPrivate.model.deleteMany({ fullName: new RegExp('mongo_test', 'i') }))

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
})

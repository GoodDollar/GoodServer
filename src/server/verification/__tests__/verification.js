import verification from '../verification'
import { GunDBPublic } from '../../gun/gun-middleware'
import UserDBPrivate from '../../db/mongo/user-privat-provider'

jest.genMockFromModule('../../gun/gun-middleware.js')

const emailVerificationCode = {
  code: 123456
}
const testUser = {
  identifier: '01',
  fullName: 'mongo_test',
  email: 'test@test.test',
  mobile: '123456789',
  emailVerificationCode: emailVerificationCode.code
}

describe('verification', () => {
  beforeAll(async done => {
    await GunDBPublic.init()
    await UserDBPrivate.updateUser(testUser)

    done()
  })

  beforeEach(() => {})

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await UserDBPrivate.model.deleteMany({ fullName: new RegExp('mongo_test', 'i') })
  })

  test('verifyUser email true', async () => {
    const isVerified = await verification.verifyEmail(testUser, emailVerificationCode)

    expect(isVerified).toBeTruthy()
  })

  test('verifyUser email false', async () => {
    const emailVerificationCodeBad = {
      code: 123457
    }

    await expect(verification.verifyEmail(testUser, emailVerificationCodeBad)).rejects.toThrow()
  })
})

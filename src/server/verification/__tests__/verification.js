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
  let user
  let verificationData

  beforeAll(async done => {
    await GunDBPublic.init()

    verificationData = {
      sessionId: 'fake-session-id',
      enrollmentIdentifier: '0x9d5499D5099DE6Fe5A8f39874617dDFc967cA6e5',
      facemapFile: './facemap.zip',
      auditTrailImageFile: './auditTrailImage.jpg'
    }

    user = { identifier: 1, fullName: 'hadar', email: 'hadarbe@gooddollar.org' }
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

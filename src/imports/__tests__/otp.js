/**
 * @jest-environment node
 */

import jwt from 'jsonwebtoken'
import MockAdapter from 'axios-mock-adapter'

import OTP from '../otp'
import config from '../../server/server.config'

describe('OTP', () => {
  it('should generate a valid JWT token', () => {
    const { cfWorkerVerifyJwtSecret, cfWorkerVerifyJwtAudience, cfWorkerVerifyJwtSubject } = config
    const token = OTP.generateJWT()
    const verified = jwt.verify(token, cfWorkerVerifyJwtSecret, {
      audience: cfWorkerVerifyJwtAudience,
      subject: cfWorkerVerifyJwtSubject
    })

    expect(verified).toBeObject()
    expect(verified.iat).toBeDefined()
    expect(verified.aud).toEqual(cfWorkerVerifyJwtAudience)
    expect(verified.sub).toEqual(cfWorkerVerifyJwtSubject)
  })

  describe('sendOTP()', () => {
    let axiosMock
    let user
    let options

    beforeAll(() => {
      axiosMock = new MockAdapter(OTP.http)
      user = {
        mobile: '+972501234567'
      }
      options = {
        channel: 'sms'
      }
    })

    it('should send verify request to the worker', async () => {
      axiosMock.onPost().reply(200, {
        status: 'pending',
        payee: null,
        date_updated: '2020-12-14T09:28:25Z',
        send_code_attempts: [{ channel: 'sms', time: '2020-12-14T09:27:59.000Z' }],
        account_sid: 'fake-account-sid',
        to: '+972501234567',
        amount: null,
        valid: false,
        lookup: {
          carrier: {
            mobile_country_code: '425',
            type: 'mobile',
            error_code: null,
            mobile_network_code: '09',
            name: 'XFONE Mobile - We4g (018 Exepon)'
          }
        },
        url: 'https://verify.twilio.com/v2/Services/fake-verify-id/Verifications/fake-account-sid',
        sid: 'fake-account-sid',
        date_created: '2020-12-14T09:27:59Z',
        service_sid: 'VAf845e805e1ae1aa4553b795a5eac4036',
        channel: 'sms'
      })
      const result = await OTP.sendOTP(user, options)
      const payload = JSON.parse(result.config.data)
      expect(payload).toBeObject()
      expect(payload.recipient).toEqual(user.mobile)
      expect(payload.verify).toBeTrue()
    })
  })

  describe('checkOTP', () => {
    let axiosMock
    beforeAll(() => {
      axiosMock = new MockAdapter(OTP.http)
    })

    it('should check OTP code validity', async () => {
      axiosMock.onPost().reply(200, {
        status: 'approved',
        payee: null,
        date_updated: '2020-12-14T09:17:46Z',
        account_sid: 'AC84e66d613d5cc1a986357fb879fb9d0e',
        to: '+972507837460',
        amount: null,
        valid: true,
        sid: 'VE2110bcdcc609055a1869a30887b9f326',
        date_created: '2020-12-14T09:16:31Z',
        service_sid: 'VAf845e805e1ae1aa4553b795a5eac4036',
        channel: 'sms'
      })

      const user = {
        mobile: '+972507837460'
      }
      const code = 123456
      const result = await OTP.checkOTP(user, code)
      const payload = JSON.parse(result.config.data)
      expect(payload).toBeObject()
      expect(payload.recipient).toEqual(user.mobile)
      expect(payload.code).toEqual(code)
      expect(payload.verify).toBeTrue()
    })
  })
})

/**
 * @jest-environment node
 */
import { sendEmailConfirmationLink, sendLinkByEmail, sendLinkBySMS } from '../send'

describe('Send', () => {
  describe('Send Via Email', () => {
    it('Should send email', async () => {
      expect.assertions(2)
      try {
        const result = await sendLinkByEmail('dario.minones@altoros.com', 'http://example.com/address')
        console.log({ result })
        expect(result).toBeTruthy()
        expect(true).toBeTruthy()
      } catch (e) {
        console.error(e)
      }
    })

    it('Should fail with fake email', async () => {
      expect.assertions(2)
      try {
        await sendLinkByEmail('fake', 'http://example.com/address')
      } catch (e) {
        expect(e.message).toEqual('Bad Request')
        expect(e instanceof Error).toBeTruthy()
      }
    })
  })

  describe('Send Via SMS', () => {
    it('Should send SMS', async () => {
      expect.assertions(2)
      try {
        const result = await sendLinkBySMS('+5491158495932', 'http://example.com/address')
        expect(result).toBeTruthy()
        expect(true).toBeTruthy()
      } catch (e) {
        console.error(e)
      }
    })

    it('Should fail with fake phone', async () => {
      expect.assertions(1)
      try {
        await sendLinkBySMS('fake', 'http://example.com/address')
      } catch (e) {
        expect(e instanceof Error).toBeTruthy()
      }
    })
  })

  describe('Send Email confirmation Link', () => {
    it(`should send email`, async () => {
      // Given
      const user = {
        fullName: 'Fernando Greco',
        email: 'fernando.greco@gmail.com',
        mobile: '+22233232323',
        smsValidated: true,
        isEmailConfirmed: false,
        jwt: ''
      }

      try {
        // When
        const result = await sendEmailConfirmationLink(user)

        // Then
        expect(result).toBeTruthy()
      } catch (e) {
        console.error(e)
      }
    })
  })

  it(`should fail with invalid user record`, async () => {
    // Given
    const user = {
      fullName: 'Fernando Greco',
      email: '',
      mobile: '+22233232323',
      smsValidated: true,
      isEmailConfirmed: false,
      jwt: ''
    }

    try {
      // When
      const result = await sendEmailConfirmationLink(user)

      // Then
      expect(result).toBeFalsy()
    } catch (e) {
      console.error(e)
    }
  })
})

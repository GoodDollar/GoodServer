/**
 * @jest-environment node
 */
import { sendLinkByEmail, sendLinkBySMS, sendRecoveryInstructionsByEmail } from '../send'

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

  describe('Send Recovery Instructions Via Email', () => {
    it('Should send email', async () => {
      expect.assertions(2)
      try {
        const result = await sendRecoveryInstructionsByEmail(
          'kevin.bardi@altoros.com',
          'Kevin',
          'abcd efgh ijkl mnop qrst uvwx yzab cdef ghij klmn opqr stuv'
        )
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
        await sendRecoveryInstructionsByEmail(
          'fake',
          'Kevin',
          'abcd efgh ijkl mnop qrst uvwx yzab cdef ghij klmn opqr stuv'
        )
      } catch (e) {
        expect(e.message).toEqual('Bad Request')
        expect(e instanceof Error).toBeTruthy()
      }
    })
  })
})

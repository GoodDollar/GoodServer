/**
 * @jest-environment node
 */
import { sendLinkByEmail } from '../send'

describe('Send', () => {
  it('Should send email', async () => {
    expect.assertions(1)
    try {
      await sendLinkByEmail('dario.minones@altoros.com', 'http://example.com/address')
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

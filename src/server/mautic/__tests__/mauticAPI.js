/**
 * @jest-environment node
 */

import { Mautic } from '../mauticAPI'

describe('Send', () => {
  var mauticId = ''
  it('should add new contact', async () => {
    const res = await Mautic.createContact({ firstname: 'h', lastname: 'r', email: 'hadar@gooddollar.org' })
    mauticId = res.contact.fields.all.id
    expect(res.contact.fields.all).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        email: 'hadar@gooddollar.org',
        firstname: 'h',
        lastname: 'r'
      })
    )
  })

  it('should send verifiction email', async () => {
    const res = await Mautic.sendVerificationEmail(
      {
        fullName: 'hadar r',
        mauticId
      },
      'https://gooddapp.com/?verification=2345'
    )
    expect(res).toEqual({ success: true })
  })

  it('should send recovery email', async () => {
    const res = await Mautic.sendRecoveryEmail(
      {
        fullName: 'h r',
        mauticId
      },
      'test seed phrase'
    )
    expect(res).toEqual({ success: true })
  })
  
  it('should send magic link email', async () => {
    const res = await Mautic.sendMagicLinkEmail(
      {
        fullName: 'h r',
        mauticId
      },
      'https://gooddapp.com/?magicline=testmagiclink'
    )
    expect(res).toEqual({ success: true })
  })
})

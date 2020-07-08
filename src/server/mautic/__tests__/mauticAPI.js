/**
 * @jest-environment node
 */

import { Mautic } from '../mauticAPI'
import conf from '../../server.config'

describe('Send', () => {
  var mauticId = ''
  it('should add new contact', async () => {
    const res = await Mautic.createContact({ firstname: 'h', lastname: 'r', email: 'hadartest@gooddollar.org' })
    mauticId = res.contact.id
    expect(res.contact.fields.all).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        email: 'hadartest@gooddollar.org',
        firstname: 'h',
        lastname: 'r'
      })
    )
  })

  it('should add tag to contact', async () => {
    const tagres = await Mautic.updateContact(mauticId, { tags: ['testtag'] })

    const foundTag = tagres.contact.tags.find(t => t.tag === 'testtag')
    expect(foundTag).toBeTruthy()
  })

  it('should add to dcn list ', async () => {
    const res = await Mautic.addContactToDNC({ mauticId })
    expect(res.contact.id).toBeTruthy()
  })

  it('should remove from dcn list ', async () => {
    const res = await Mautic.deleteContactFromDNC({ mauticId })
    expect(res.recordFound).toBeTruthy()
  })

  it('should send verifiction email', async () => {
    const res = await Mautic.sendVerificationEmail(
      {
        fullName: 'hadar r',
        mauticId
      },
      '745231'
    )
    expect(res).toEqual({ success: true })
  })

  it('should send recovery email', async () => {
    const recoverPageUrl = `${conf.walletUrl}/Auth/Recover`
    const res = await Mautic.sendRecoveryEmail(
      {
        fullName: 'h r',
        mauticId
      },
      'red brave onion car photo label loop lazy massive fart test rank',
      recoverPageUrl
    )
    expect(res).toEqual({ success: true })
  })

  it('should send magic link email', async () => {
    const res = await Mautic.sendMagicLinkEmail(
      {
        fullName: 'h r',
        mauticId
      },
      'https://gooddapp.com/?magiclink=testmagiclink'
    )
    expect(res).toEqual({ success: true })
  })

  it('should add contact to segment', async () => {
    const res = await Mautic.addContactsToSegment([mauticId], conf.mauticClaimQueueApprovedSegmentId)
    expect(res.details[mauticId].success).toEqual(true)
  })

  it('should delete contact', async () => {
    const res = await Mautic.deleteContact({
      fullName: 'h r',
      mauticId
    })
    expect(res.contact.fields.all).toEqual(
      expect.objectContaining({
        email: 'hadartest@gooddollar.org',
        firstname: 'h',
        lastname: 'r'
      })
    )
  })
})

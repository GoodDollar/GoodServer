/**
 * @jest-environment node
 */

import { Mautic } from '../mauticAPI'
import conf from '../../server.config'
import { utmString } from '../../__util__'

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
    const res = await Mautic.addContactsToSegment([mauticId], conf.mauticClaimQueueWhitelistedSegmentId)
    expect(res.details[mauticId].success).toEqual(true)
  })

  it('should delete contact', async () => {
    const res = await Mautic.deleteContact(mauticId)

    expect(res.contact.fields.all).toEqual(
      expect.objectContaining({
        email: 'hadartest@gooddollar.org',
        firstname: 'h',
        lastname: 'r'
      })
    )
  })

  it('should parse utm tags', () => {
    const tags = Mautic.parseUtmString(utmString)

    expect(tags).toEqual({
      source_utm: 'twitter',
      medium_utm: 'banner',
      campaign_utm: 'Test_campaign_name_:-)',
      term_utm: 'test-term',
      content_utm: 'test-contant'
    })
  })

  it('should skip empty tags', () => {
    const tags = Mautic.parseUtmString('utmcsr=|utmcmd=(not set)|utmccn=(not%20set)|utmctr=test-term')

    expect(tags).toEqual({ term_utm: 'test-term' })
  })

  it('should skip unknown tags', () => {
    const tags = Mautic.parseUtmString('utmtest=test|utmctr=test-term')

    expect(tags).toEqual({ term_utm: 'test-term' })
  })
})

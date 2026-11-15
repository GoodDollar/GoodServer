// @flow
import { SES as MockSES } from '@aws-sdk/client-ses'
import { sendTemplateEmail } from '../aws-ses'
import conf from '../../server.config'
import { punycodeDomain } from '../../utils/email'

jest.mock('@aws-sdk/client-ses', () => {
  const mSES = {
    sendTemplatedEmail: jest.fn()
  }
  return { SES: jest.fn(() => mSES) }
})

describe('sendTemplateEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should send an email with SES service', async () => {
    const mSes = new MockSES()
    mSes.sendTemplatedEmail.mockResolvedValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })
    const templateData = {
      firstname: 'MyName',
      code: '12345'
    }

    const recipientEmail = 'some@email.com'
    await sendTemplateEmail(recipientEmail, templateData)
    expect(mSes.sendTemplatedEmail).toBeCalledWith({
      ConfigurationSetName: 'walletEmails',
      Source: conf.awsSesSourceVerificationEmail,
      Destination: {
        ToAddresses: [punycodeDomain(recipientEmail)]
      },
      Template: conf.awsSesTemplateName,
      TemplateData: JSON.stringify(templateData)
    })
    expect(mSes.sendTemplatedEmail).toBeCalledTimes(1)
  })

  it('should throw if templateData is missing firstname param', async () => {
    const mSes = new MockSES()
    mSes.sendTemplatedEmail.mockResolvedValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    const recipientEmail = 'some@email.com'
    const templateData = {
      code: '12345'
    }
    const error = await sendTemplateEmail(recipientEmail, templateData).catch(error => error)
    expect(mSes.sendTemplatedEmail).toBeCalledTimes(0)
    expect(error.message).toEqual(`Invalid templateData ${JSON.stringify(templateData)}`)
  })
  it('should throw if templateData is missing code param', async () => {
    const mSes = new MockSES()
    mSes.sendTemplatedEmail.mockResolvedValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    const recipientEmail = 'some@email.com'
    const templateData = {
      firstname: 'MyName'
    }
    const error = await sendTemplateEmail(recipientEmail, templateData).catch(error => error)
    expect(mSes.sendTemplatedEmail).toBeCalledTimes(0)
    expect(error.message).toEqual(`Invalid templateData ${JSON.stringify(templateData)}`)
  })
  it('should accept a numeric code', async () => {
    const mSes = new MockSES()
    mSes.sendTemplatedEmail.mockResolvedValue({ MessageId: 'id' })

    await sendTemplateEmail('some@email.com', { firstname: 'MyName', code: 123456 })

    expect(mSes.sendTemplatedEmail).toBeCalledTimes(1)
  })

  it.each([
    ['non-string firstname', { firstname: 42, code: '12345' }],
    ['object firstname', { firstname: { a: 1 }, code: '12345' }],
    ['object code', { firstname: 'MyName', code: { a: 1 } }],
    ['boolean code', { firstname: 'MyName', code: true }],
    ['empty firstname', { firstname: '', code: '12345' }]
  ])('should throw on %s', async (_, templateData) => {
    const mSes = new MockSES()
    const error = await sendTemplateEmail('some@email.com', templateData).catch(error => error)

    expect(mSes.sendTemplatedEmail).toBeCalledTimes(0)
    expect(error.message).toEqual(`Invalid templateData ${JSON.stringify(templateData)}`)
  })
})

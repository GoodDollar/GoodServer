// @flow
import MockSES from 'aws-sdk/clients/ses'
import { sendTemplateEmail } from '../aws-ses'
import conf from '../../server.config'

jest.mock('aws-sdk/clients/ses', () => {
  const mSES = {
    sendTemplatedEmail: jest.fn().mockReturnThis(),
    promise: jest.fn()
  }
  return jest.fn(() => mSES)
})

describe('sendTemplateEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should send an email with SES service', async () => {
    const mSes = new MockSES()
    mSes.sendTemplatedEmail().promise.mockReturnValue({
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
      Source: conf.awsSesSourceVerificationEmail,
      Destination: {
        ToAddresses: [recipientEmail]
      },
      Template: conf.awsSesTemplateName,
      TemplateData: JSON.stringify(templateData)
    })
    expect(mSes.sendTemplatedEmail().promise).toBeCalledTimes(1)
  })

  it('should throw if templateData is missing firstname param', async () => {
    const mSes = new MockSES();
    mSes.sendTemplatedEmail().promise.mockReturnValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    const recipientEmail = 'some@email.com'
    const templateData = {
      code: '12345'
    }
    const error = await sendTemplateEmail(recipientEmail, templateData).catch(error => error)
    expect(mSes.sendTemplatedEmail().promise).toBeCalledTimes(0)
    expect(error.message).toEqual(`Invalid templateData ${JSON.stringify(templateData)}`)
  })
  it('should throw if templateData is missing code param', async () => {
    const mSes = new MockSES();
    mSes.sendTemplatedEmail().promise.mockReturnValue({
      ResponseMetadata: { RequestId: '78ecb4ef-2f7d-4d97-89e7-ccd56423f802' },
      MessageId: '01020175847408e6-057f405d-f09d-46ce-85eb-811528988332-000000'
    })

    const recipientEmail = 'some@email.com'
    const templateData = {
      firstname: 'MyName'
    }
    const error = await sendTemplateEmail(recipientEmail, templateData).catch(error => error)
    expect(mSes.sendTemplatedEmail().promise).toBeCalledTimes(0)
    expect(error.message).toEqual(`Invalid templateData ${JSON.stringify(templateData)}`)
  })
})

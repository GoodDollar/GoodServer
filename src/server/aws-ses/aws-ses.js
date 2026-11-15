// @flow
import { SES } from '@aws-sdk/client-ses'
import conf from '../server.config'
import { punycodeDomain } from '../utils/email'

const accessKeyId = conf.awsSesAccessKey
const secretAccessKey = conf.awsSesSecretAccessKey
const region = conf.awsSesRegion
const sourceVerificationEmail = conf.awsSesSourceVerificationEmail
const templateName = conf.awsSesTemplateName

const runInEnv = ['production', 'staging'].includes(conf.env)

if (runInEnv) {
  if (!accessKeyId || !secretAccessKey || !region || !sourceVerificationEmail || !templateName) {
    throw new Error('Missing AWS configuration')
  }
}

const SES_CONFIG = {
  credentials: { accessKeyId, secretAccessKey },
  region
}

const ses = new SES(SES_CONFIG)

// const sendEmail = (recipientEmail, name) => {
//   const params = {
//     Source: 'omerz@gooddollar.com',
//     Destination: {
//       ToAddresses: [recipientEmail]
//     },
//     ReplyToAddresses: [],
//     Message: {
//       Body: {
//         Html: {
//           Charset: 'UTF-8',
//           Data: 'This is the body of my email!'
//         }
//       },
//       Subject: {
//         Charset: 'UTF-8',
//         Data: `Hello, ${name}!`
//       }
//     }
//   }
//   return ses.sendEmail(params).promise()
// }

export const sendTemplateEmail = async (recipientEmail: string, templateData: Object) => {
  const templateDataStr = JSON.stringify(templateData)

  const { firstname, code } = templateData

  // firstname must be a non-empty string, code a non-empty string or a number
  const isValidFirstname = typeof firstname === 'string' && firstname !== ''
  const isValidCode = (typeof code === 'string' && code !== '') || (typeof code === 'number' && code !== 0)

  if (!isValidFirstname || !isValidCode) {
    throw new Error(`Invalid templateData ${templateDataStr}`)
  }

  const params = {
    Source: sourceVerificationEmail,
    Template: templateName,
    Destination: {
      ToAddresses: [punycodeDomain(recipientEmail)]
    },
    TemplateData: templateDataStr,
    ConfigurationSetName: 'walletEmails'
  }

  return ses.sendTemplatedEmail(params)
}

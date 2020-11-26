// @flow
import SES from 'aws-sdk/clients/ses'
import conf from '../server.config'

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
  accessKeyId,
  secretAccessKey,
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

  if (
    !templateData.firstname ||
    !typeof templateData.firstname === 'string' ||
    !templateData.code ||
    typeof !templateData.code === 'number'
  ) {
    throw new Error(`Invalid templateData ${templateDataStr}`)
  }

  const params = {
    Source: sourceVerificationEmail,
    Template: templateName,
    Destination: {
      ToAddresses: [recipientEmail]
    },
    TemplateData: templateDataStr
  }

  return ses.sendTemplatedEmail(params).promise()
}

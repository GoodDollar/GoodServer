// @flow
import sgMail from '@sendgrid/mail'
import * as plivo from 'plivo'

import conf from '../server.config'
import logger from '../../imports/pino-logger'

sgMail.setApiKey(conf.sendGrid.apiKey)

const log = logger.child({ from: 'AdminWallet' })

export const sendLinkByEmail = (to: string, link: string) => {
  const text = `You got GD. To withdraw open: ${link}`
  const msg = {
    to,
    from: conf.noReplyEmail,
    subject: 'Sending GD via Good Dollar App',
    html: text,
    text
  }
  return sgMail.send(msg).catch(error => {
    //Log friendly error
    log.error(error.toString())
    throw error
  })
}

export const sendLinkBySMS = (to: string, link: string) => {
  console.log({ conf })
  const { plivoAuthID, plivoAuthToken, plivoPhoneNumber } = conf
  const client = new plivo.Client(plivoAuthID, plivoAuthToken)
  const text = `You got GD. To withdraw open: ${link}`

  return client.messages.create(plivoPhoneNumber, to, text)
}

/**
 * Sends an email with recovery instructions to the user's registered email through SendGrid.
 * Send it by an API using a Transactional Template
 *
 * @param {string} to - User email
 * @param {string} name - User name
 * @param {string} key - Mnemonic key
 * @returns {Promise<R>|Promise<R|*>}
 */
export const sendRecoveryInstructionsByEmail = (to: string, name: string, key: string) => {
  const msg: any = {
    personalizations: [
      {
        dynamic_template_data: {
          name,
          key
        },
        to: [
          {
            email: to,
            name
          }
        ]
      }
    ],
    from: {
      email: conf.noReplyEmail
    },
    subject: 'Congratulations! You have a good dollar account',
    template_id: conf.sendGrid.templates.recoveryInstructions
  }

  return sgMail.send(msg).catch(error => {
    //Log friendly error
    log.error(error.toString())
    throw error
  })
}

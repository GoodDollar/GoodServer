// @flow
import sgMail from '@sendgrid/mail'
import * as plivo from 'plivo'

import conf from '../server.config'
import logger from '../../imports/logger'

import type { UserRecord } from '../../imports/types'
import { generateOTP } from '../../imports/otp'

sgMail.setApiKey(conf.sendGrid.apiKey)

const log = logger.child({ from: 'send.js' })

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
    template_id: conf.sendGrid.templates.recoveryInstructions
  }

  log.debug({ msg })

  return sgMail.send(msg).catch(error => {
    // Log friendly error
    log.error(error.toString())
    throw error
  })
}

/**
 * Sends an email to the user's registered email through SendGrid.send API using a Transactional Template
 * @param {UserRecord} user - User profile
 * @returns {Promise<R>|Promise<R|*>}
 */
export const sendEmailConfirmationLink = (user: UserRecord) => {
  const validationHash = generateOTP(10)
  const validationLink = `${conf.walletUrl}/Signup/EmailConfirmation/?validation=${validationHash}`

  // structure required by SendGrid API: https://sendgrid.api-docs.io/v3.0/mail-send
  const msg: any = {
    personalizations: [
      {
        dynamic_template_data: {
          receiver_name: user.fullName,
          validation_link: validationLink
        },
        to: [
          {
            email: user.email,
            name: user.fullName
          }
        ]
      }
    ],
    from: {
      email: conf.noReplyEmail
    },
    template_id: conf.sendGrid.templates.emailConfirmation
  }

  log.debug({ msg })

  return sgMail
    .send(msg)
    .then(() => validationHash)
    .catch(error => {
      //Log friendly error
      log.error(error.toString())
      throw error
    })
}

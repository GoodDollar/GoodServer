import conf from '../server.config'
import logger from '../../imports/pino-logger'

import sgMail from '@sendgrid/mail'
import * as plivo from 'plivo'

sgMail.setApiKey(conf.sendGridApiKey)

const log = logger.child({ from: 'AdminWallet' })

export const sendLinkByEmail = (to, link) => {
  const text = `You got GD. To withdraw open: ${link}`
  const msg = {
    to,
    from: 'no-reply@gooddollar.com',
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

export const sendLinkBySMS = async (to, link) => {
  console.log({ conf })
  const { plivoAuthID, plivoAuthToken, plivoPhoneNumber } = conf
  const client = new plivo.Client(plivoAuthID, plivoAuthToken)
  const text = `You got GD. To withdraw open: ${link}`

  return client.messages.create(plivoPhoneNumber, to, text)
}

export const sendRecoveryInstructionsByEmail = (to, name, key) => {
  const text = `
    Congratulations ${name}! You have a good dollar account. \n
    Please save the key to recover your account:
      - Your key is: <b>${key}</b>
  `
  const msg = {
    to,
    from: 'no-reply@gooddollar.com',
    subject: 'Congratulations! You have a good dollar account',
    html: text,
    text
  }
  return sgMail.send(msg).catch(error => {
    //Log friendly error
    log.error(error.toString())
    throw error
  })
}

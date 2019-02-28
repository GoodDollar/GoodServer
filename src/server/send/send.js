import conf from '../server.config'
import logger from '../../imports/pino-logger'

const sgMail = require('@sendgrid/mail')
sgMail.setApiKey(conf.sendGridApiKey)

const log = logger.child({ from: 'AdminWallet' })

export const sendLinkByEmail = async (to, link) => {
  const text = `You got GD. To withdraw open: ${link}`
  const msg = {
    to,
    from: 'no-reply@gooddollar.com',
    subject: 'Sending GD via Good Dollar App',
    html: text,
    text
  }
  await sgMail.send(msg).catch(error => {
    //Log friendly error
    log.error(error.toString())
    throw error
  })
}

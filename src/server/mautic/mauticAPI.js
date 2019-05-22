// @flow
import fetch from 'cross-fetch'
import logger from '../../imports/pino-logger'

import { UserRecord } from '../../imports/types'
import Config from '../server.config'

const log = logger.child({ from: 'Mautic' })

export const Mautic = {
  baseUrl: Config.mauticURL,
  baseHeaders: {
    Authorization: `Bearer ${Config.mauticToken}`,
    'Content-Type': 'application/json'
  },
  baseQuery(url, headers, body, method = 'post') {
    const fullUrl = `${this.baseUrl}${url}`
    return fetch(fullUrl, { method, body: JSON.stringify(body), headers })
      .then(async res => {
        if (res.status >= 300) throw new Error(await res.text())
        return res.json()
      })
      .catch(e => {
        delete body['mnemonic'] //hide confidential information
        log.error('Mautic Error:', url, e, { body })
        throw e
      })
  },
  deleteContact(user: UserRecord) {
    return this.baseQuery(`/contacts/${user.mauticId}/delete`, this.baseHeaders, {}, 'delete')
  },
  createContact(user: UserRecord) {
    return this.baseQuery('/contacts/new', this.baseHeaders, user)
  },
  sendVerificationEmail(user: UserRecord, link: string) {
    if (!(link && user.fullName && user.mauticId && Config.mauticVerifyEmailId))
      throw new Error('missing input for sending verification email')

    return this.baseQuery(`/emails/${Config.mauticVerifyEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { link, firstName: user.fullName }
    })
  },
  sendRecoveryEmail(user: UserRecord, mnemonic: string) {
    if (!(mnemonic && user.fullName && user.mauticId && Config.mauticRecoveryEmailId))
      throw new Error('missing input for sending recovery email')

    return this.baseQuery(`/emails/${Config.mauticRecoveryEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { seed: mnemonic, firstName: user.fullName }
    })
  }
}

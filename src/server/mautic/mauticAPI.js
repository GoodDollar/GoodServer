// @flow
import fetch from 'cross-fetch'
import logger from '../../imports/pino-logger'

import { UserRecord } from '../../imports/types'
import Config from '../server.config'

const log = logger.child({ from: 'Mautic' })
const Timeout = (timeout: msec) => {
  return new Promise((res, rej) => {
    setTimeout(rej, timeout, new Error('Request Timeout'))
  })
}

export const Mautic = {
  baseUrl: Config.mauticURL,
  baseHeaders: {
    Authorization: `Bearer ${Config.mauticToken}`,
    'Content-Type': 'application/json'
  },

  baseQuery(url, headers, body, method = 'post', timeout = 15000) {
    const fullUrl = `${this.baseUrl}${url}`

    return Promise.race([Timeout(timeout), fetch(fullUrl, { method, body: JSON.stringify(body), headers })])
      .then(async res => {
        log.debug(res)
        if (res.status >= 300) throw new Error(await res.text())
        return res.json()
      })
      .catch(e => {
        delete body['mnemonic'] //hide confidential information
        log.error('Mautic Error:', url, e.message, { body })
        log.trace(e)
        throw e
      })
  },

  updateContact(mauticId, newEmail) {
    return this.baseQuery(`/contacts/${mauticId}/edit`, this.baseHeaders, { email: newEmail }, 'patch')
  },

  deleteContact(user: UserRecord) {
    return this.baseQuery(`/contacts/${user.mauticId}/delete`, this.baseHeaders, {}, 'delete')
  },

  createContact(user: UserRecord) {
    const tags = ['dappuser']
    if (Config.isEtoro) tags.push('etorobeta')
    return this.baseQuery('/contacts/new', this.baseHeaders, { ...user, tags })
  },

  sendVerificationEmail(user: UserRecord, code: string) {
    if (!(code && user.fullName && user.mauticId && Config.mauticVerifyEmailId))
      throw new Error('missing input for sending verification email')

    return this.baseQuery(`/emails/${Config.mauticVerifyEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { code, firstName: user.fullName }
    })
  },

  sendRecoveryEmail(user: UserRecord, mnemonic: string, recoverPageUrl: string) {
    if (!(mnemonic && user.fullName && user.mauticId && Config.mauticRecoveryEmailId))
      throw new Error('missing input for sending recovery email')

    const mnemonicFirstPart = mnemonic
      .split(' ')
      .slice(0, 6)
      .join(' ')
    const mnemonicSecondPart = mnemonic
      .split(' ')
      .slice(6)
      .join(' ')

    return this.baseQuery(`/emails/${Config.mauticRecoveryEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { firstName: user.fullName, seedFirst: mnemonicFirstPart, seedSecond: mnemonicSecondPart, recoverPageUrl }
    })
  },

  sendMagicLinkEmail(user: UserRecord, magicLink: string) {
    if (!(magicLink && user.fullName && user.mauticId && Config.mauticmagicLinkEmailId))
      throw new Error('missing input for sending magicLink email')

    return this.baseQuery(`/emails/${Config.mauticmagicLinkEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { link: magicLink, firstName: user.fullName }
    })
  }
}

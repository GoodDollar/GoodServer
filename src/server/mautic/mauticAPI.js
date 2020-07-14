// @flow
import fetch from 'cross-fetch'
import { get } from 'lodash'

import logger from '../../imports/logger'
import { UserRecord } from '../../imports/types'
import Config from '../server.config'
import requestTimeout from '../utils/timeout'

const log = logger.child({ from: 'Mautic' })

export const Mautic = {
  baseUrl: Config.mauticURL,
  baseHeaders: {
    Authorization: Config.mauticBasicToken ? `Basic ${Config.mauticBasicToken}` : `Bearer ${Config.mauticToken}`,
    'Content-Type': 'application/json'
  },

  baseQuery(url, headers, body, method = 'post', timeout = 15000) {
    const fullUrl = `${this.baseUrl}${url}`

    return Promise.race([requestTimeout(timeout), fetch(fullUrl, { method, body: JSON.stringify(body), headers })])
      .then(async res => {
        log.debug(res)
        if (res.status >= 300) throw new Error(await res.text())
        return res.json()
      })
      .catch(e => {
        delete body['mnemonic'] //hide confidential information
        log.error('Mautic Error:', { url, errMessage: e.message, body })

        throw e
      })
  },

  updateContact(mauticId, newFields) {
    return this.baseQuery(`/contacts/${mauticId}/edit`, this.baseHeaders, newFields, 'patch')
  },

  deleteContact(user: UserRecord) {
    if (user.mauticId === undefined) return Promise.resolve()
    return this.baseQuery(`/contacts/${user.mauticId}/delete`, this.baseHeaders, {}, 'delete')
  },

  deleteContactFromDNC(user: UserRecord, group = 'email') {
    if (user.mauticId === undefined) return Promise.resolve()
    return this.baseQuery(`/contacts/${user.mauticId}/dnc/${group}/remove`, this.baseHeaders, {}, 'post')
  },

  addContactToDNC(user: UserRecord, group = 'email') {
    if (user.mauticId === undefined) return Promise.resolve()
    return this.baseQuery(`/contacts/${user.mauticId}/dnc/${group}/add`, this.baseHeaders, {}, 'post')
  },

  async createContact(user: UserRecord) {
    const tags = [Config.newuserTag]
    if (user.email === undefined) {
      log.error('failed creating contact, no email.', { user })
      return Promise.reject('failed creating contact. no email.')
    }
    if (Config.isEtoro) tags.push('etorobeta')
    tags.push(Config.version)
    const mauticRecord = await this.baseQuery('/contacts/new', this.baseHeaders, { ...user, tags })

    const mauticId = get(mauticRecord, 'contact.id', -1)
    if (mauticId === -1) log.error('Mautic Error createContact failed', { user, tags, mauticRecord })
    log.info('createContact result:', { mauticId, email: user.email })
    await Mautic.deleteContactFromDNC({ mauticId })

    return mauticRecord
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
    if (!(magicLink && user.fullName && user.mauticId && Config.mauticmagicLinkEmailId)) {
      log.warn('missing input for sending magiclink', { magicLink, user, emailId: Config.mauticmagicLinkEmailId })
      throw new Error('missing input for sending magicLink email')
    }

    return this.baseQuery(`/emails/${Config.mauticmagicLinkEmailId}/contact/${user.mauticId}/send`, this.baseHeaders, {
      tokens: { link: magicLink, firstName: user.fullName }
    })
  },

  addContactsToSegment(mauticIdsArr: Array<Number>, segmentId: string) {
    return this.baseQuery(`/segments/${segmentId}/contacts/add`, this.baseHeaders, {
      ids: mauticIdsArr
    })
  }
}

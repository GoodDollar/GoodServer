// @flow
import fetch from 'cross-fetch'
import { get, assign, range, isNil } from 'lodash'

import logger from '../../imports/logger'
import { UserRecord } from '../../imports/types'
import Config from '../server.config'
import requestTimeout from '../utils/timeout'

// TODO: use axios instead
export const Mautic = new (class {
  tagsMap = {
    utmctr: 'term_utm',
    utmcct: 'content_utm',
    utmcsr: 'source_utm',
    utmcmd: 'medium_utm',
    utmccn: 'campaign_utm'
  }

  constructor(config, log) {
    const { mauticURL, mauticBasicToken, mauticToken } = config

    this.baseUrl = mauticURL
    assign(this, { log, config })

    this.baseHeaders = {
      'Content-Type': 'application/json',
      Authorization: mauticBasicToken ? `Basic ${mauticBasicToken}` : `Bearer ${mauticToken}`
    }
  }

  baseQuery(url, headers, body = null, method = 'post', timeout = 15000) {
    const { baseUrl, log } = this
    const fullUrl = baseUrl + url
    const fetchOptions = { method, headers }

    if (!isNil(body)) {
      fetchOptions.body = JSON.stringify(body)
    }

    return Promise.race([requestTimeout(timeout), fetch(fullUrl, fetchOptions)])
      .then(async res => {
        log.debug('response for:', { fullUrl, res })
        if (res.status >= 300) throw new Error(await res.text())
        return res.json()
      })
      .catch(e => {
        delete body['mnemonic'] // hide confidential information
        log.error('Mautic Error:', e.message, e, { url, body })

        throw e
      })
  }

  parseUtmString(utmString) {
    const { tagsMap } = this

    return (utmString || '').split('|').reduce((tags, record) => {
      const [name, value] = record.split('=')
      const tagValue = decodeURIComponent(value)

      if (name in tagsMap && tagValue && '(not set)' !== tagValue) {
        const mappedName = tagsMap[name]

        tags[mappedName] = tagValue
      }

      return tags
    }, {})
  }

  async getContact(mauticId) {
    const { baseHeaders, log } = this
    return this.baseQuery(`/contacts/${mauticId}`, baseHeaders, null, 'get')
  }

  async contactExists(mauticId) {
    const { log } = this
    let isExists = true

    try {
      await this.getContact(mauticId)
    } catch {
      // TODO: re-check HTTP, response set isExists = false only if the 404 with "contact not found" was returned
      // otherwise just rethrow
      log.warn("Contact doesn't exists:", { mauticId })
      isExists = false
    }

    return isExists
  }

  async updateContact(mauticId, newFields) {
    const { log } = this
    let mauticRecord
    try {
      mauticRecord = await this.baseQuery(`/contacts/${mauticId}/edit`, this.baseHeaders, newFields, 'patch')
      return mauticRecord
    } catch (e) {
      //sometimes duplicate record exists and causes exception, lets try to update instead
      const duplicateId = await this.deleteDuplicate(undefined, mauticId)
      if (duplicateId) {
        log.warn('updateContact: found duplicate contact, deleted and updated', { keptId: duplicateId })
        return this.baseQuery(`/contacts/${mauticId}/edit`, this.baseHeaders, newFields, 'patch')
      } else {
        throw e
      }
    }
  }

  async searchContact(email) {
    const result = await this.baseQuery(`/contacts?search=${email}`, this.baseHeaders, null, 'get')
    const ids = Object.keys(get(result || {}, 'contacts', {}))
    if (ids.length > 1) {
      this.log.warn('searchContact founds multiple ids:', ids)
    }
    return ids.sort()
  }

  async deleteDuplicate(email, mauticId) {
    if (mauticId) {
      const contact = await this.getContact(mauticId)
      email = get(contact, 'contact.fields.all.email')
    }
    if (!email) return false
    const ids = await this.searchContact(email).catch(e => {
      this.log.warn('deleteDuplicate search failed:', email, e.message, e)
      return []
    })
    if (ids.length > 1) {
      this.log.warn('deleteDuplicate found duplicate user:', ids)
      const toDelete = ids.filter(_ => _ !== mauticId).pop()
      const res = await this.deleteContact(toDelete)
      this.log.info('deleted duplicate contact', { toDelete, res })
      return ids[0]
    }
    return false
  }

  async deleteContact(user: UserRecord) {
    if (!user.mauticId) {
      return
    }

    return this.baseQuery(`/contacts/${user.mauticId}/delete`, this.baseHeaders, {}, 'delete')
  }

  async deleteContactFromDNC(user: UserRecord, group = 'email') {
    if (!user.mauticId) {
      return
    }

    return this.baseQuery(`/contacts/${user.mauticId}/dnc/${group}/remove`, this.baseHeaders, {}, 'post')
  }

  async addContactToDNC(user: UserRecord, group = 'email') {
    if (!user.mauticId) {
      return
    }

    return this.baseQuery(`/contacts/${user.mauticId}/dnc/${group}/add`, this.baseHeaders, {}, 'post')
  }

  async createContact(user: UserRecord) {
    const { log, config } = this
    const { newuserTag, version, isEtoro } = config
    const tags = [newuserTag]

    if (user.email === undefined) {
      log.error('failed creating contact, no email.', 'Email is required', new Error('Email is required'), { user })
      return Promise.reject('failed creating contact. no email.')
    }

    if (isEtoro) {
      tags.push('etorobeta')
    }

    tags.push(version)

    let mauticId, mauticRecord
    try {
      mauticRecord = await this.baseQuery('/contacts/new', this.baseHeaders, { ...user, tags })
      mauticId = get(mauticRecord, 'contact.id', -1)
    } catch (e) {
      //sometimes duplicate record exists and causes exception, lets try to update instead
      const duplicateId = await this.deleteDuplicate(user.email)
      if (duplicateId) {
        mauticRecord = await this.updateContact(duplicateId, { ...user, tags })
        log.info('found duplicate contact, deleted and updated instead', { keptId: duplicateId })
      } else {
        throw e
      }
      mauticId = duplicateId
    }

    if (mauticId === -1) {
      log.error('Mautic Error createContact failed', '', null, { user, tags, mauticRecord })
    }

    log.info('createContact result:', { mauticId, email: user.email })
    await Mautic.deleteContactFromDNC({ mauticId })

    return mauticRecord
  }

  sendVerificationEmail(user: UserRecord, code: string) {
    const { baseHeaders, config } = this
    const { mauticVerifyEmailId } = config
    const { mauticId, fullName } = user

    if (!(code && fullName && mauticId && mauticVerifyEmailId)) {
      throw new Error('missing input for sending verification email')
    }

    return this.baseQuery(`/emails/${mauticVerifyEmailId}/contact/${mauticId}/send`, baseHeaders, {
      tokens: { code, firstName: fullName }
    })
  }

  sendRecoveryEmail(user: UserRecord, mnemonic: string, recoverPageUrl: string) {
    const { baseHeaders, config } = this
    const { mauticRecoveryEmailId } = config
    const { mauticId, fullName } = user

    if (!(mnemonic && fullName && mauticId && mauticRecoveryEmailId)) {
      throw new Error('missing input for sending recovery email')
    }

    const mnemonicWords = mnemonic.split(/\s+/)
    const [seedFirst, seedSecond] = range(2).map(index =>
      mnemonicWords.slice(index * 6, index ? undefined : 6).join(' ')
    )

    return this.baseQuery(`/emails/${mauticRecoveryEmailId}/contact/${mauticId}/send`, baseHeaders, {
      tokens: { firstName: user.fullName, seedFirst, seedSecond, recoverPageUrl }
    })
  }

  sendMagicLinkEmail(user: UserRecord, magicLink: string) {
    const { baseHeaders, config, log } = this
    const { mauticmagicLinkEmailId } = config
    const { mauticId, fullName } = user

    if (!(magicLink && fullName && mauticId && mauticmagicLinkEmailId)) {
      log.warn('missing input for sending magiclink', { magicLink, user, emailId: mauticmagicLinkEmailId })
      throw new Error('missing input for sending magicLink email')
    }

    return this.baseQuery(`/emails/${mauticmagicLinkEmailId}/contact/${mauticId}/send`, baseHeaders, {
      tokens: { link: magicLink, firstName: user.fullName }
    })
  }

  addContactsToSegment(mauticIdsArr: Array<Number>, segmentId: string) {
    return this.baseQuery(`/segments/${segmentId}/contacts/add`, this.baseHeaders, {
      ids: mauticIdsArr
    })
  }
})(Config, logger.child({ from: 'Mautic' }))

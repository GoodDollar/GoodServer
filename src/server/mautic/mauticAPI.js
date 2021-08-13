// @flow
import fetch from 'cross-fetch'
import { get, assign, range, isNil, omit, isObject } from 'lodash'

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
        if (res.status >= 300) {
          const statusText = await res.text()
          log.warn('response for:', { fullUrl, statusText })

          throw new Error(statusText)
        }
        const json = await res.json()
        log.debug('response for:', { fullUrl, json })
        return json
      })
      .catch(e => {
        let redactedBody = body

        if (isObject(body)) {
          // hide confidential information
          redactedBody = omit(body, 'mnemonic')
        }

        log.warn('Mautic Error:', e.message, e, { url, body: redactedBody })

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
    const { baseHeaders } = this

    return this.baseQuery(`/contacts/${mauticId}`, baseHeaders, null, 'get')
  }

  async contactExists(mauticId, logger) {
    const log = logger || this.log
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

  async updateContact(mauticId, newFields, logger) {
    const log = logger || this.log
    let mauticRecord
    try {
      mauticRecord = await this.baseQuery(`/contacts/${mauticId}/edit`, this.baseHeaders, newFields, 'patch')
      return mauticRecord
    } catch (e) {
      log.warn('updateContact failed', e.message, e)
      throw e
    }
  }

  async searchContact(email, logger) {
    const log = logger || this.log
    const result = await this.baseQuery(`/contacts?search=${email}`, this.baseHeaders, null, 'get')
    const ids = Object.keys(get(result || {}, 'contacts', {})) || []
    if (ids.length > 1) {
      log.warn('searchContact founds multiple ids:', ids)
    }
    return ids.sort()
  }

  /**
   * deletes any duplicates if exists and return a single mauticId for the email
   * @param {*} email
   * @param {*} mauticId
   * @returns the contact mauticId if exists
   */
  async searchAndDeleteDuplicate(email, logger) {
    const log = logger || this.log
    if (!email) return
    const ids = await this.searchContact(email, log).catch(e => {
      log.warn('deleteDuplicate search failed:', email, e.message, e)
      return []
    })

    if (ids.length > 1) {
      const [id, ...dups] = ids

      log.warn('deleteDuplicate found duplicate user:', ids)

      await Promise.all(
        dups.map(async toDelete => {
          const res = await this.deleteContact(toDelete)

          log.info('deleted duplicate contact', { toDelete, res })
        })
      )

      return id
    }

    return ids.pop()
  }

  async deleteContact(mauticId) {
    if (!mauticId) {
      return
    }

    return this.baseQuery(`/contacts/${mauticId}/delete`, this.baseHeaders, {}, 'delete')
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

  async createContact(user: UserRecord, logger) {
    let { log, config } = this
    log = logger || log
    const { newuserTag, version, isEtoro } = config
    const tags = [newuserTag]

    if (user.email === undefined) {
      log.warn('failed creating contact, no email.', 'Email is required', new Error('Email is required'), { user })
      return Promise.reject('failed creating contact. no email.')
    }

    if (isEtoro) {
      tags.push('etorobeta')
    }

    tags.push(version)

    let mauticId, mauticRecord

    try {
      // sometimes duplicate record exists and causes exception, lets try to update instead
      mauticId = await this.searchAndDeleteDuplicate(user.email, log).catch(e =>
        log.warn('createContact deleteduplicate failed:', e.message, e)
      )

      if (mauticId) {
        mauticRecord = await this.updateContact(mauticId, { ...user, tags }, log)
        log.info('createContact found existing contact', { mauticId })
      } else {
        mauticRecord = await this.baseQuery('/contacts/new', this.baseHeaders, { ...user, tags })
        mauticId = get(mauticRecord, 'contact.id', -1)
      }
    } catch (e) {
      log.warn('createContact failed', e.message, e)
      throw e
    }

    if (mauticId === -1) {
      const e = new Error('createContact failed')

      log.error('Mautic Error:', e.message, e, { user, tags, mauticRecord })
      throw e
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
      this.log.error('missing input for sending recovery email', {
        mnemonic,
        fullName,
        mauticId,
        mauticRecoveryEmailId
      })
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

  async setWhitelisted(mauticId, log) {
    const { mauticClaimQueueWhitelistedSegmentId } = Config
    if (!mauticId) return
    return Promise.all([
      this.updateContact(mauticId, { tags: ['claimqueue_claimed'] }, log).catch(exception => {
        const { message } = exception

        log.warn('Failed Mautic tagging user claimed', message, exception, { mauticId })
      }),
      this.addContactsToSegment([mauticId], mauticClaimQueueWhitelistedSegmentId).catch(exception => {
        const { message } = exception

        log.warn('Failed Mautic adding user to claim queue whitelisted segment', message, exception)
      })
    ])
  }
})(Config, logger.child({ from: 'Mautic' }))

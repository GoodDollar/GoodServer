//@flow

import fetch from 'cross-fetch'
import { get, isNil } from 'lodash'
import { UserRecord } from '../../imports/types'
import logger from '../../imports/logger'
import Config from '../server.config'
import requestTimeout from '../utils/timeout'

export type Contact = {
  identifier: string,
  first_name: string,
  last_name: string,
  mobile?: string,
  email: string,
  regmethod: string,
  torusprovider: string,
  term_utm: string,
  content_utm: string,
  source_utm: string,
  medium_utm: string,
  campaign_utm: string
}

export type Tags = {
  whitelisted?: string,
  version_joined?: string
}

interface CRMAPI {
  createContact(contact: UserRecord, logger): string;
  updateContact(identifier: string, fields: { [key: string]: stirng }, tags: Tags, logger): string;
  userRecordToContact(contact: UserRecord): Contact;
  deleteContactFromDNC(email: string, logger): any;
  addContactToDNC(email: string, logger): any;
  getContactByEmail(email: string, logger): any;
  getContactById(id: string, logger): any;
  deleteContact(id: string, logger): any;
  setWhitelisted(id: string, logger): any;
}

const tagsMap = {
  utmctr: 'term_utm',
  utmcct: 'content_utm',
  utmcsr: 'source_utm',
  utmcmd: 'medium_utm',
  utmccn: 'campaign_utm'
}

export const parseUtmString = utmString => {
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

export class OnGage implements CRMAPI {
  baseUrl: string
  config: {}
  log = logger.child({ from: 'OnGage' })

  constructor(apiurl: string, account_code: string, apikey: string, apisecret: string, config: {}) {
    this.config = config
    this.baseUrl = apiurl
    this.baseHeaders = {
      'Content-Type': 'application/json',
      X_USERNAME: apikey,
      X_PASSWORD: apisecret,
      X_ACCOUNT_CODE: account_code
    }
  }

  baseQuery(url, headers, body = null, method = 'post', timeout = 15000) {
    const { baseUrl, log } = this
    const fullUrl = baseUrl + url
    const fetchOptions = { method, headers: { ...this.baseHeaders, headers } }

    if (!isNil(body)) {
      fetchOptions.body = JSON.stringify(body)
    }
    console.log({ fullUrl, fetchOptions })
    return Promise.race([requestTimeout(timeout), fetch(fullUrl, fetchOptions)])
      .then(async res => {
        if (res.status >= 300) {
          const statusText = await res.text()
          log.warn('ongage: response for:', { fullUrl, statusText })

          throw new Error(statusText)
        }
        const json = await res.json()
        log.debug('ongage: response for:', { fullUrl, json })
        if (get(json, 'payload.warnings')) {
          log.error('ongage request warnings:', { fullUrl, body, warnings: get(json, 'payload.warnings') })
        }
        return json
      })
      .catch(e => {
        log.warn('Ongage Error:', e.message, e, { url, body })

        throw e
      })
  }

  async createContact(user: UserRecord, logger): any {
    let { log, config } = this
    log = logger || log
    const { version } = config

    const contact = this.userRecordToContact(user)
    if (contact.email === undefined) {
      log.warn('failed creating contact, no email.', { contact })
      return Promise.reject('ongage: failed creating contact. no email.')
    }

    let tags = { version_joined: version }

    let result

    try {
      result = await this._updateOrCreate(contact, tags, logger)
    } catch (e) {
      log.warn('ongage: createContact failed', e.message, e, { contact, tags })
      throw e
    }

    log.info('createContact result:', { result, email: contact.email })
    await this.deleteContactFromDNC(contact.email)

    return result
  }

  async updateContact(email: string, fields: { [key: string]: string }, tags: Tags, logger): any {
    const log = logger || this.log
    let result
    try {
      result = await this._updateOrCreate({ email, ...fields }, tags, logger)
      return result
    } catch (e) {
      log.warn('ongage: updateContact failed', e.message, e)
      throw e
    }
  }

  async _updateOrCreate(contact: Contact, tags: Tags, logger): string {
    let fields = { ...contact, ...tags }
    const result = await this.baseQuery('contacts', {}, { email: contact.email, overwrite: true, fields })

    const contactId =
      get(result, `payload.created_emails['${contact.email}']`) ||
      get(result, `payload.updated_emails['${contact.email}']`)
    return contactId
  }

  async deleteContactFromDNC(email: string, logger): any {
    return this.baseQuery('contacts/change_status', [], { emails: [email], change_to: 'resubscribe' })
  }

  async addContactToDNC(email: string, logger): any {
    return this.baseQuery('contacts/change_status', [], { emails: [email], change_to: 'unsubscribe' })
  }

  async getContactByEmail(email: string, logger): any {
    return this.baseQuery(`contacts/by_email/${email}`, [], null, 'GET')
  }
  async getContactById(id: string, logger): any {
    return this.baseQuery(`contacts/by_id/${id}`, [], null, 'GET')
  }
  async deleteContact(id: string, logger): any {
    return this.baseQuery(`contacts/delete`, [], { contact_id: id })
  }

  async setWhitelisted(id: string, logger): any {
    return this._updateOrCreate({ id }, { whitelisted: 'true' }, logger)
  }
}

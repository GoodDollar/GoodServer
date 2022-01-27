//@flow

import fetch from 'cross-fetch'
import { get, isNil, fromPairs } from 'lodash'
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
  campaign_utm: string,
  whitelisted?: string,
  version_joined?: string,
  signup_completed?: string
}

interface CRMAPI {
  createContact(contact: UserRecord, logger): string;
  updateContact(identifier: string, fields: { [key: string]: stirng }, logger): string;
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

const fieldsMap = {
  firstName: 'first_name',
  lastName: 'last_name',
  fullName: 'fullname',
  regMethod: 'regmethod',
  torusProvider: 'torusprovider'
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
  log = logger.child({ from: 'OnGage' })

  constructor(apiurl: string, account_code: string, apikey: string, apisecret: string) {
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

  userRecordToContact(user: UserRecord): Contact {
    let contact = Object.entries(user).map(([k, v]) => {
      const newkey = fieldsMap[k] || k.toLowerCase()
      return [newkey, v]
    })
    return fromPairs(contact)
  }
  async createContact(user: UserRecord, logger): any {
    let { log } = this
    log = logger || log
    const { version, env } = Config

    const contact = this.userRecordToContact(user)
    if (contact.email === undefined) {
      log.warn('failed creating contact, no email.', { contact })
      return Promise.reject('ongage: failed creating contact. no email.')
    }

    contact.version_joined = version
    contact.dev_env = env

    let result

    try {
      result = await this._updateOrCreate(contact, logger)
    } catch (e) {
      log.warn('ongage: createContact failed', e.message, e, { contact })
      throw e
    }

    log.info('createContact result:', { result, email: contact.email })
    await this.deleteContactFromDNC(contact.email)

    return result
  }

  async updateContact(email: string, id: string, fields: { [key: string]: string }, logger): any {
    const log = logger || this.log
    let result
    try {
      result = await this._updateOrCreate({ email, id, ...fields }, logger)
      return result
    } catch (e) {
      log.warn('ongage: updateContact failed', e.message, e)
      throw e
    }
  }

  async _updateOrCreate(contact: Contact, logger): string {
    let fields = { ...contact }
    delete fields['id']
    if (!fields['email']) delete fields['email'] //in case of udpate and email is null
    let result
    //incase of update by id we use PUT
    if (contact.id) result = await this.baseQuery('contacts', {}, { id: contact.id, overwrite: true, fields }, 'PUT')
    else result = await this.baseQuery('contacts', {}, { email: contact.email, overwrite: true, fields })

    const contactIdOrEmail =
      get(result, `payload.created_emails['${contact.email}']`) ||
      get(result, `payload.updated_emails['${contact.email}']`) ||
      get(result, `payload.success_emails['${contact.email}']`)
    return contactIdOrEmail
  }

  async updateContactEmail(crmId: string, newEmail: string, logger): any {
    const log = logger || this.log
    let result
    try {
      const contact = await this.getContactById(crmId, logger)
      const email = get(contact, 'payload.email')
      result = await this.baseQuery('contacts/change_email', {}, { email, new_email: newEmail })
      return get(result, `payload.success_emails['${email}']`)
    } catch (e) {
      log.warn('ongage: updateContactEmail failed', e.message, e)
      throw e
    }
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

export const OnGageAPI = new OnGage(Config.ongageUrl, Config.ongageAccount, Config.ongageKey, Config.ongageSecret)

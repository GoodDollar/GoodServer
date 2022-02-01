// @flow

import Axios from 'axios'
import { get, assign } from 'lodash'
import Config from '../server.config'

import logger from '../../imports/logger'

import { type UserRecord } from '../../imports/types'
import { userRecordToContact, type CrmApi, type Contact } from './api'

class OnGage implements CrmApi {
  http = null
  log = null
  contactDefaults = {}

  constructor(Config, httpFactory, logger) {
    const { version, env } = Config
    const httpClientOptions = this._configureClient(Config, logger)

    this.log = logger
    this.http = httpFactory(httpClientOptions)

    this.contactDefaults = {
      version_joined: version,
      dev_env: env
    }

    this._configureRequests()
    this._configureResponses()
  }

  async createContact(user: UserRecord, logger = null): any {
    let result
    const log = logger || this.log
    const contact = userRecordToContact(user)

    if (contact.email === undefined) {
      log.warn('failed creating contact, no email.', { contact })

      throw new Error('OnGage: failed creating contact. no email.')
    }

    assign(contact, this.contactDefaults)

    try {
      result = await this._upsertContact(contact, logger)
    } catch (exception) {
      log.warn('OnGage: createContact failed', exception.message, exception, { contact })
      throw exception
    }

    log.info('createContact result:', { result, email: contact.email })
    await this.deleteContactFromDNC(contact.email)

    return result
  }

  async updateContact(email: string, id: string, fields: { [key: string]: string }, logger = null): any {
    const log = logger || this.log

    try {
      return await this._upsertContact({ email, id, ...fields }, logger)
    } catch (exception) {
      log.warn('OnGage: updateContact failed', exception.message, exception)
      throw exception
    }
  }

  async updateContactEmail(crmId: string, newEmail: string, logger = null): any {
    const log = logger || this.log

    try {
      const contact = await this.getContactById(crmId, logger)
      const email = get(contact, 'payload.email')
      const payload = { email, new_email: newEmail }

      const result = await this.http.post('contacts/change_email', payload, { logger })
      const emails = get(result, 'payload.success_emails')

      return emails[email]
    } catch (exception) {
      log.warn('OnGage: updateContactEmail failed', exception.message, exception)
      throw exception
    }
  }

  async deleteContactFromDNC(email: string, logger = null): any {
    const payload = {
      emails: [email],
      change_to: 'resubscribe'
    }

    return this.http.post('contacts/change_status', payload, { logger })
  }

  async addContactToDNC(email: string, logger = null): any {
    const payload = {
      emails: [email],
      change_to: 'unsubscribe'
    }

    return this.http.post('contacts/change_status', payload, { logger })
  }

  async getContactByEmail(email: string, logger = null): any {
    const params = { email }

    return this.http.get(`contacts/by_email/:email`, { logger, params })
  }

  async getContactById(id: string, logger = null): any {
    const params = { id }

    return this.http.get(`contacts/by_id/:id`, { logger, params })
  }

  async deleteContact(id: string, logger = null): any {
    const payload = {
      contact_id: id
    }

    return this.http.post(`contacts/delete`, payload, { logger })
  }

  async setWhitelisted(id: string, logger = null): any {
    return this._upsertContact({ id, whitelisted: 'true' }, logger)
  }

  async _upsertContact(contact: Contact, logger = null): Promise<string> {
    let result
    const overwrite = true
    const { http } = this

    const { id, ...fields } = contact
    const { email } = fields

    if (id) {
      // in case of udpate and email is null
      if (!email) {
        delete fields.email
      }

      result = await http.put('contacts', { id, overwrite, fields }, { logger })
    } else {
      result = await http.post('contacts', { email, overwrite, fields }, { logger })
    }

    return (
      get(result, `payload.created_emails['${contact.email}']`) ||
      get(result, `payload.updated_emails['${contact.email}']`) ||
      get(result, `payload.success_emails['${contact.email}']`)
    )
  }

  _configureClient(Config, log) {
    const { ongageUrl, ongageAccount, ongageKey, ongageSecret } = Config

    const httpClientOptions = {
      validateStatus: status => status < 300,
      baseURL: ongageUrl,
      timeout: 3000,

      headers: {
        X_USERNAME: ongageKey,
        X_PASSWORD: ongageSecret,
        X_ACCOUNT_CODE: ongageAccount,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    }

    log.debug('Initialized OnGage client with the options:', httpClientOptions)
    return httpClientOptions
  }

  _configureRequests() {
    const { request } = this.http.interceptors

    request.use(request => {
      const { url, params } = request
      const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || {})

      const substituteParameter = (_, parameter) => {
        const parameterValue = searchParams.get(parameter) || ''

        searchParams.delete(parameter)
        return encodeURIComponent(parameterValue)
      }

      return {
        ...request,
        params: searchParams,
        url: (url || '').replace(/:(\w[\w\d]+)/g, substituteParameter)
      }
    })
  }

  _configureResponses() {
    const { http, log } = this
    const { response } = http.interceptors

    response.use(
      async response => {
        const { config, data: json } = response
        const { warnings } = json.payload || {}
        const { url, data: body, logger = log } = config

        logger.debug('OnGage: response for:', { url, json })

        if (warnings) {
          logger.error('ongage request warnings:', { url, body, warnings })
        }

        return json
      },
      async exception => {
        const { message, response = {} } = exception
        const { url, data: body, logger = log } = response.config || {}

        logger.warn('OnGage Error:', message, exception, { url, body })
        throw exception
      }
    )
  }
}

export default new OnGage(Config, Axios, logger.child({ from: 'OnGage' }))

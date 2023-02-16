// @flow

import Axios from 'axios'
import axiosRetry from 'axios-retry'
import { get, assign, values, first, isError } from 'lodash'

import Config from '../server.config'
import logger from '../../imports/logger'

import { type UserRecord } from '../../imports/types'
import { userRecordToContact, type Contact } from './api'
import { shouldUpdateEmail } from './utils'

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

    this._configureRequests(Config)
    this._configureResponses()
  }

  async createContact(user: UserRecord, logger = null): any {
    let result
    const log = logger || this.log
    const contact = userRecordToContact(user)

    if (contact.email === undefined) {
      log.warn('failed creating contact, no email.', { contact })

      throw new Error('OnGage: failed creating contact - no email.')
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
      return await this._upsertContact({ id, email, ...fields }, logger)
    } catch (exception) {
      log.warn('OnGage: updateContact failed', exception.message, exception)
      throw exception
    }
  }

  async updateContactEmail(crmId: string, newEmail: string, logger = null): any {
    const log = logger || this.log

    try {
      const contact = await this.getContactById(crmId, logger)
      const { id, email } = contact.payload || {}

      // verify not a just a case difference
      if (!shouldUpdateEmail(email, newEmail)) {
        return { id }
      }

      // verify for newEmail contact existence
      const duplicateId = await this.getContactIdByEmail(newEmail, logger)

      if (duplicateId) {
        // remove if exists
        await this.deleteContact(duplicateId, logger)
      }

      const payload = { email, new_email: newEmail }
      const result = await this.http.put('contacts/change_email', payload, { logger })
      const emails = get(result, 'payload.success_emails')
      const response = { id: emails[email] }

      return duplicateId ? { ...response, duplicateId } : response
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

    return this.http.post('v2/contacts/change_status', payload, { logger })
  }

  async addContactToDNC(email: string, logger = null): any {
    const payload = {
      emails: [email],
      change_to: 'unsubscribe'
    }

    return this.http.post('v2/contacts/change_status', payload, { logger })
  }

  async getContactByEmail(email: string, logger = null): any {
    const params = { email }

    return this.http.get(`contacts/by_email/:email`, { logger, params })
  }

  async getContactById(id: string, logger = null): any {
    const params = { id }

    return this.http.get(`contacts/by_id/:id`, { logger, params })
  }

  async getContactIdByEmail(email, logger) {
    try {
      const existingContact = await this.getContactByEmail(email, logger)

      return get(existingContact, 'payload.id')
    } catch (exception) {
      if (404 !== get(exception, 'response.status')) {
        throw exception
      }
    }

    return null
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

  /** @private */
  async _upsertContact(contact: Contact, logger = null): Promise<string> {
    let result
    const overwrite = true
    const { http } = this

    const { id, email, ...fields } = contact
    const payload = { email, overwrite, fields }

    // add email to fields if set
    if (email) {
      assign(fields, { email })
    }

    if (id) {
      if (!email) {
        // in case of update and email is null - use id as primary key
        assign(payload, { id })
        delete payload.email
      }

      result = await http.put('v2/contacts', payload, { logger })
    } else {
      if (!email) {
        throw new Error('Cannot add contact with empty email!')
      }

      result = await http.post('v2/contacts', payload, { logger })
    }

    const [createdEmails, updatedEmails, successEmails] = ['created', 'updated', 'success'].map(prop =>
      get(result, `payload.${prop}_emails`, {})
    )

    if (email) {
      return createdEmails[email] || updatedEmails[email] || successEmails[email]
    }

    const [firstCreated, firstUpdated, firstSuccess] = [createdEmails, updatedEmails, successEmails].map(hashMap =>
      first(values(hashMap))
    )

    return firstCreated || firstUpdated || firstSuccess
  }

  /** @private */
  _configureClient(Config, log) {
    const { ongageUrl, ongageAccount, ongageKey, ongageSecret, ongageTimeout } = Config

    const httpClientOptions = {
      validateStatus: status => status < 300,
      baseURL: ongageUrl,
      timeout: ongageTimeout,

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

  /** @private */
  _configureRequests(Config) {
    const { http } = this
    const { ongageRetryAttempts, ongageRetryDelay } = Config
    const { request } = http.interceptors

    axiosRetry(http, {
      retries: ongageRetryAttempts,
      retryDelay: count => ongageRetryDelay * 2 ** count,
      retryCondition: reason => {
        const { message, response } = reason || {}
        const { status } = response || {}
        const timeoutRe = /timeout of.+exceeded/i

        return isError(reason) && (timeoutRe.test(message) || 429 === status)
      }
    })

    request.use(({ url, params, logger, ...requestOptions }) => {
      const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || {})

      const substituteParameter = (_, parameter) => {
        const parameterValue = searchParams.get(parameter) || ''

        searchParams.delete(parameter)
        return encodeURIComponent(parameterValue)
      }

      const options = {
        ...requestOptions,
        params: searchParams,
        url: (url || '').replace(/:(\w[\w\d]+)/g, substituteParameter)
      }

      if (!logger) {
        return options
      }

      return { ...options, logger }
    })
  }

  /** @private */
  _configureResponses() {
    const { http, log } = this
    const { response } = http.interceptors

    response.use(
      async response => {
        const { config, data: json } = response
        const retryStatus = get(config, 'axios-retry', {})

        // due to the retries we could process response twice
        // here is a simple check to handle this
        if (!retryStatus.hasOwnProperty('retryCount')) {
          // if no retry metadata - response was already processed
          // so we should just return it 'as is'
          return response
        }

        const { warnings } = json.payload || {}
        const { url, data: body, logger = log } = config

        logger.debug('OnGage response for:', { url, json })

        if (warnings) {
          logger.error('OnGage request warnings:', { url, body, warnings })
        }

        return json
      },
      async exception => {
        const { message, response = {} } = exception
        const { config, status } = response
        const { url, data: body, logger = log } = config || {}

        if (404 !== status) {
          logger.warn('OnGage error:', message, exception, { url, body })
        }

        throw exception
      }
    )
  }
}

export default new OnGage(Config, Axios.create, logger.child({ from: 'OnGage' }))

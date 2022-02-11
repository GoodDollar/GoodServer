// @flow

import MockAdapter from 'axios-mock-adapter'
import { first, last, mapValues, toPairs } from 'lodash'

import Config from '../../server.config'
import OnGage from '../ongage'
import createMockingHelper from './__util__'
import { levelConfigs } from '../../../imports/logger/options'

let helper
let mock

const contactId = 'fake-contact-id'
const contactEmail = 'fake@email.contact.com'

const contactFields = {
  email: contactEmail,
  whitelisted: false,
  fullname: 'Fake User'
}

const userRecord = {
  email: contactEmail,
  fullName: contactFields.fullname,
  firstName: 'Fake',
  lastName: 'User',
  regMethod: 'torus',
  torusProvider: 'google'
}

const createLoggerMock = () => mapValues(levelConfigs.levels, () => jest.fn())

describe('OnGage', () => {
  beforeAll(() => {
    mock = new MockAdapter(OnGage.http)
    helper = createMockingHelper(mock)
  })

  afterEach(() => mock.reset())

  afterAll(() => {
    mock.restore()
    mock = null
    helper = null
  })

  test('should authorize', async () => {
    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId)

    const getRequest = first(mock.history.get)

    expect(getRequest.headers).toHaveProperty('X_USERNAME', Config.ongageKey)
    expect(getRequest.headers).toHaveProperty('X_PASSWORD', Config.ongageSecret)
    expect(getRequest.headers).toHaveProperty('X_ACCOUNT_CODE', Config.ongageAccount)
  })

  test('should substitute params to url', async () => {
    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId)

    const getRequest = first(mock.history.get)

    expect(getRequest).not.toBeUndefined()
    expect(getRequest).toHaveProperty('url', helper.contactUrl(contactId))
  })

  test('should use custom logger', async () => {
    const loggerMock = createLoggerMock()

    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId, loggerMock)

    expect(loggerMock.debug).toHaveBeenCalled()
  })

  test('should throw on server error', async () => {
    const loggerMock = createLoggerMock()

    helper.mockFailedGetContact(contactId)

    await expect(OnGage.getContactById(contactId, loggerMock)).rejects.toThrow()
    expect(loggerMock.warn).toHaveBeenCalled()
    expect(loggerMock.warn.mock.calls[0][0]).toBe('OnGage error:')
  })

  test('should report warnings', async () => {
    const loggerMock = createLoggerMock()

    helper.mockSuccessGetContact(contactId, { warnings: {} })
    await OnGage.getContactById(contactId, loggerMock)

    expect(loggerMock.error).toHaveBeenCalled()
    expect(loggerMock.error.mock.calls[0][0]).toBe('OnGage request warnings:')
  })

  test('should add to contact to DNC / remove from', async () => {
    const map = {
      addContactToDNC: 'unsubscribe',
      deleteContactFromDNC: 'resubscribe'
    }

    helper.mockSuccessChangeStatus()

    await toPairs(map).reduce(
      (promise, [method, operation]) =>
        promise.then(async () => {
          await expect(OnGage[method](contactEmail)).toResolve()

          const postRequest = last(mock.history.post)
          const jsonPayload = JSON.parse(postRequest.data)

          expect(jsonPayload).toEqual({
            change_to: operation,
            emails: [contactEmail]
          })
        }),
      Promise.resolve()
    )
  })

  test('should delete contact', async () => {
    helper.mockSuccessDeleteContact()

    await expect(OnGage.deleteContact(contactId)).toResolve()

    const postRequest = first(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(jsonPayload).toEqual({
      contact_id: contactId
    })
  })

  test('upsert: should add contact', async () => {
    helper.mockSuccessCreateContact(contactEmail, contactId)

    await expect(OnGage.updateContact(contactEmail, null, contactFields)).resolves.toBe(contactId)

    const postRequest = first(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(jsonPayload).toEqual({
      email: contactEmail,
      overwrite: true,
      fields: contactFields
    })
  })

  test('upsert: should update contact', async () => {
    helper.mockSuccessUpdateContact(contactEmail, contactId)

    await expect(OnGage.updateContact(contactEmail, contactId, contactFields)).resolves.toBe(contactId)

    const putRequest = first(mock.history.put)
    const jsonPayload = JSON.parse(putRequest.data)

    expect(jsonPayload).toEqual({
      id: contactId,
      overwrite: true,
      fields: contactFields
    })
  })

  test('upsert: should not set empty email on update', async () => {
    const { email, ...fields } = contactFields

    helper.mockSuccessUpdateContact(contactEmail, contactId)

    await expect(OnGage.updateContact(contactEmail, contactId, { ...fields, email: '' })).resolves.toBe(contactId)

    const putRequest = first(mock.history.put)
    const jsonPayload = JSON.parse(putRequest.data)

    expect(jsonPayload).toEqual({
      id: contactId,
      overwrite: true,
      fields
    })
  })

  test('should set whitelisted', async () => {
    helper.mockSuccessUpdateContact(contactEmail, contactId)

    await expect(OnGage.setWhitelisted(contactId)).resolves.toBe(contactId)

    const putRequest = first(mock.history.put)
    const jsonPayload = JSON.parse(putRequest.data)

    expect(jsonPayload).toEqual({
      id: contactId,
      overwrite: true,
      fields: { whitelisted: 'true' }
    })
  })

  test('should update email', async () => {
    const newEmail = 'new@fake-email.com'

    helper.mockSuccessGetContact(contactId, { email: contactEmail })
    helper.mockSuccessUpdateEmail(contactEmail, contactId)

    await expect(OnGage.updateContactEmail(contactId, newEmail)).resolves.toBe(contactId)

    const postRequest = first(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(jsonPayload).toEqual({
      email: contactEmail,
      new_email: newEmail
    })
  })

  test('should convert user record, add defaults and create contact', async () => {
    helper.mockSuccessCreateContact(contactEmail, contactId)
    helper.mockSuccessChangeStatus()

    await expect(OnGage.createContact(userRecord)).resolves.toBe(contactId)

    const postRequest = first(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(jsonPayload).toEqual({
      email: contactEmail,
      overwrite: true,
      fields: {
        ...OnGage.contactDefaults,
        email: contactEmail,
        fullname: contactFields.fullname,
        first_name: 'Fake',
        last_name: 'User',
        regmethod: 'torus',
        torusprovider: 'google'
      }
    })
  })

  test('createContact: should remove from DNC after create', async () => {
    helper.mockSuccessCreateContact(contactEmail, contactId)
    helper.mockSuccessChangeStatus()

    await expect(OnGage.createContact(userRecord)).toResolve()

    const postRequest = last(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(postRequest).toHaveProperty('url', 'contacts/change_status')
    expect(jsonPayload).toHaveProperty('change_to', 'resubscribe')
  })

  test('createContact: throws on empty email', async () => {
    const { email, ...record } = userRecord

    await expect(OnGage.createContact(record)).rejects.toThrow('OnGage: failed creating contact - no email.')
  })
})

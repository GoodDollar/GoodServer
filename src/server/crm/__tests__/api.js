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

  xtest('should authorize', async () => {
    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId)

    const getRequest = first(mock.history.get)

    expect(getRequest.headers).toHaveProperty('X_USERNAME', Config.ongageKey)
    expect(getRequest.headers).toHaveProperty('X_PASSWORD', Config.ongageSecret)
    expect(getRequest.headers).toHaveProperty('X_ACCOUNT_CODE', Config.ongageAccount)
  })

  xtest('should substitute params to url', async () => {
    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId)

    const getRequest = first(mock.history.get)

    expect(getRequest).not.toBeUndefined()
    expect(getRequest).toHaveProperty('url', helper.contactUrl(contactId))
  })

  xtest('should use custom logger', async () => {
    const loggerMock = createLoggerMock()

    helper.mockSuccessGetContact(contactId)
    await OnGage.getContactById(contactId, loggerMock)

    expect(loggerMock.debug).toHaveBeenCalled()
  })

  xtest('should throw on server error', async () => {
    const loggerMock = createLoggerMock()

    helper.mockFailedGetContact(contactId)

    await expect(OnGage.getContactById(contactId, loggerMock)).rejects.toThrow()
    expect(loggerMock.warn).toHaveBeenCalled()
    expect(loggerMock.warn.mock.calls[0][0]).toBe('OnGage error:')
  })

  xtest('should report warnings', async () => {
    const loggerMock = createLoggerMock()

    helper.mockSuccessGetContact(contactId, { warnings: {} })
    await OnGage.getContactById(contactId, loggerMock)

    expect(loggerMock.error).toHaveBeenCalled()
    expect(loggerMock.error.mock.calls[0][0]).toBe('OnGage request warnings:')
  })

  xtest('should add to contact to DNC / remove from', async () => {
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

  xtest('should delete contact', async () => {
    helper.mockSuccessDeleteContact()

    await expect(OnGage.deleteContact(contactId)).toResolve()

    const postRequest = first(mock.history.post)
    const jsonPayload = JSON.parse(postRequest.data)

    expect(jsonPayload).toEqual({
      contact_id: contactId
    })
  })
})

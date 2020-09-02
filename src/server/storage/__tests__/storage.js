// @flow
import { assign } from 'lodash'

import config from '../../server.config'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import type { UserRecord } from '../../../imports/types'

import addUserSteps from '../addUserSteps'
import { getCreds } from '../../__util__'

jest.setTimeout(30000)

describe('storageAPI', () => {
  const isCompletedAllFalse = {
    whiteList: false,
    w3Record: false,
    topWallet: false
  }
  const isCompletedAllTrue = {
    whiteList: true,
    w3Record: true,
    topWallet: false
  }
  const user: UserRecord = {
    identifier: 'test_user',
    email: 'test@test.tt',
    full_name: 'test test',
    isCompleted: isCompletedAllFalse
  }

  beforeAll(async () => {
    await UserDBPrivate.addUser(user)
  })

  afterAll(async () => {
    await UserDBPrivate.deleteUser(user)
  })

  test('check isCompletedAllFalse', async () => {
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted).toMatchObject(isCompletedAllFalse)
  })

  test('check updateMauticRecord', async () => {
    const creds = await getCreds()
    const userRecord = { ...creds, ...user }
    await addUserSteps.updateMauticRecord(userRecord, console)
    const mauticId = await UserDBPrivate.getUserField(user.identifier, 'mauticId')
    expect(mauticId).toBeTruthy()
  })

  test('should not addUserToWhiteList when faceverification enabled', async () => {
    const { disableFaceVerification } = config

    let userIsCompleted
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }

    try {
      config.disableFaceVerification = false
      userRecord.profilePublickey = String(Math.random())
      await addUserSteps.addUserToWhiteList(userRecord, console)
      userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    } finally {
      assign(config, { disableFaceVerification })
    }

    expect(userIsCompleted.whiteList).toBeFalsy()
  })

  test('should addUserToWhiteList when faceverification disabled', async () => {
    const { disableFaceVerification } = config

    let userIsCompleted
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }

    try {
      config.disableFaceVerification = true
      userRecord.profilePublickey = String(Math.random())
      await addUserSteps.addUserToWhiteList(userRecord, console)
      userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    } finally {
      assign(config, { disableFaceVerification })
    }

    expect(userIsCompleted.whiteList).toBeTruthy()
  })

  test('check updateW3Record', async () => {
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    await addUserSteps.updateW3Record(userRecord, console)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.w3Record).toBeTruthy()
  })

  test('check isCompletedAllTrue', async () => {
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted).toMatchObject(isCompletedAllTrue)
  })

  test('db should have claimQueue indexed', async () => {
    const indexes = await UserDBPrivate.model.listIndexes()
    const found = indexes.find(x => {
      return x.name.indexOf('claimQueue.status') >= 0
    })
    expect(found).toBeTruthy()
  })
  test('user should not be in claim queue', async () => {
    const queue = await UserDBPrivate.getUserField(user.identifier, 'claimQueue')
    expect(queue).toBeFalsy()
  })

  test('user should be added to queue', async () => {
    await UserDBPrivate.updateUser({ identifier: user.identifier, claimQueue: { status: 'pending', date: Date.now() } })
    const queue = await UserDBPrivate.getUserField(user.identifier, 'claimQueue')
    expect(queue).toMatchObject({ status: 'pending', date: expect.anything() })
  })

  test('user should be marked as whitelisted', async () => {
    const queue = await UserDBPrivate.getUserField(user.identifier, 'claimQueue')
    await UserDBPrivate.updateUser({ identifier: user.identifier, 'claimQueue.status': 'whitelisted' })
    const updated = await UserDBPrivate.getUserField(user.identifier, 'claimQueue')
    expect(updated).toMatchObject({ status: 'whitelisted', date: queue.date })
  })
})

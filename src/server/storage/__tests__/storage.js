// @flow
import { assign } from 'lodash'

import config from '../../server.config'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import type { UserRecord } from '../../../imports/types'

import addUserSteps from '../addUserSteps'
import { getCreds } from '../../__util__'
import AdminWallet from '../../blockchain/AdminWallet'

describe('storageAPI', () => {
  const isCompletedAllFalse = {
    whiteList: false,
    topWallet: false
  }
  const isCompletedAllTrue = {
    whiteList: true,
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
    const mockedFunc = AdminWallet.whitelistUser
    AdminWallet.whitelistUser = jest.fn().mockImplementation(() => Promise.resolve(true))
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
    AdminWallet.whitelistUser = mockedFunc
  })

  test('check isCompletedAllTrue', async () => {
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted).toMatchObject(isCompletedAllTrue)
  })
})

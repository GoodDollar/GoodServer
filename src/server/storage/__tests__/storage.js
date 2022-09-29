// @flow
import { assign } from 'lodash'

import config from '../../server.config'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import type { UserRecord } from '../../../imports/types'

import { addUserToWhiteList } from '../addUserSteps'
import { getCreds } from '../../__util__'
import AdminWallet from '../../blockchain/AdminWallet'

describe('storageAPI', () => {
  const mockedFunc = AdminWallet.whitelistUser
  const { disableFaceVerification } = config

  let creds
  let userIsCompleted
  let userRecord

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
    creds = await getCreds(true)
    userRecord = { ...creds, ...user, gdAddress: creds.address }

    AdminWallet.whitelistUser = jest.fn().mockImplementation(() => Promise.resolve(true))
    await UserDBPrivate.addUser(user)
  })

  afterAll(async () => {
    AdminWallet.whitelistUser = mockedFunc
    await UserDBPrivate.deleteUser(user)
  })

  test('check isCompletedAllFalse', async () => {
    userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')

    expect(userIsCompleted).toMatchObject(isCompletedAllFalse)
  })

  test('should not addUserToWhiteList when faceverification enabled', async () => {
    const { disableFaceVerification } = config

    try {
      config.disableFaceVerification = false
      userRecord.profilePublickey = String(Math.random())

      await addUserToWhiteList(userRecord, console)
      userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    } finally {
      assign(config, { disableFaceVerification })
    }

    expect(userIsCompleted.whiteList).toBeFalsy()
  })

  test('should addUserToWhiteList when faceverification disabled', async () => {
    try {
      config.disableFaceVerification = true
      userRecord.profilePublickey = String(Math.random())

      await addUserToWhiteList(userRecord, console)
      userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    } finally {
      assign(config, { disableFaceVerification })
    }

    expect(userIsCompleted.whiteList).toBeTruthy()
  })

  test('check isCompletedAllTrue', async () => {
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    console.log(userIsCompleted)

    expect(userIsCompleted).toMatchObject(isCompletedAllTrue)
  })
})

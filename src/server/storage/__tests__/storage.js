// @flow
import type { UserRecord } from '../../../imports/types'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { getCreds } from '../../__util__'
import addUserSteps from '../addUserSteps'

jest.setTimeout(30000)

describe('storageAPI', () => {
  const isCompletedAllFalse = {
    whiteList: false,
    w3Record: false,
    marketToken: false,
    topWallet: false
  }
  const isCompletedAllTrue = {
    whiteList: true,
    w3Record: true,
    marketToken: true,
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
    await addUserSteps.updateMauticRecord(userRecord)
    const mauticId = await UserDBPrivate.getUserField(user.identifier, 'mauticId')
    expect(mauticId).toBeTruthy()
  })

  test('check addUserToWhiteList', async () => {
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    userRecord.profilePublicKey = '' + Math.random()
    await addUserSteps.addUserToWhiteList(userRecord)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.whiteList).toBeTruthy()
  })

  test('check updateW3Record', async () => {
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    await addUserSteps.updateW3Record(userRecord)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.w3Record).toBeTruthy()
  })

  test('check updateMarketToken', async () => {
    await addUserSteps.updateMarketToken(user)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.marketToken).toBeTruthy()
  })

  test('check isCompletedAllTrue', async () => {
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted).toMatchObject(isCompletedAllTrue)
  })
})

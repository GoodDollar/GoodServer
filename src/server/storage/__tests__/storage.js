// @flow
import type { UserRecord } from '../../../imports/types'
import UserDBPrivate from '../../db/mongo/user-privat-provider'
import { getCreds } from '../../__util__'
import addUserSteps from '../addUserSteps'
import config from '../../server.config'
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
    await addUserSteps.updateMauticRecord(userRecord, console)
    const mauticId = await UserDBPrivate.getUserField(user.identifier, 'mauticId')
    expect(mauticId).toBeTruthy()
  })

  test('should not  addUserToWhiteList when faceverification enabled', async () => {
    config.disableFaceVerification = false
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    userRecord.profilePublickey = String(Math.random())
    await addUserSteps.addUserToWhiteList(userRecord, console)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.whiteList).toBeFalsy()
  })

  test('should addUserToWhiteList when faceverification disabled', async () => {
    config.disableFaceVerification = true
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    userRecord.profilePublickey = String(Math.random())
    await addUserSteps.addUserToWhiteList(userRecord, console)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.whiteList).toBeTruthy()
  })

  test('check updateW3Record', async () => {
    const creds = await getCreds(true)
    let userRecord = { ...creds, ...user, gdAddress: creds.address }
    await addUserSteps.updateW3Record(userRecord, console)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.w3Record).toBeTruthy()
  })

  test('check updateMarketToken', async () => {
    await addUserSteps.updateMarketToken(user, console)
    const userIsCompleted = await UserDBPrivate.getUserField(user.identifier, 'isCompleted')
    expect(userIsCompleted.marketToken).toBeTruthy()
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

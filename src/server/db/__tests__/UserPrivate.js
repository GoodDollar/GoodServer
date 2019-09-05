/**
 * @jest-environment node
 */
import UserDBPrivate from '../mongo/user-privat-provider'
import mongoose from '../mongo-db'
import _ from 'lodash'

const storage = UserDBPrivate

const testUser = { identifier: '00', fullName: 'mongo_test', email: 'test@test.test', mobile: '123456789' }

jest.setTimeout(30000)

describe('UserPrivate', () => {
  afterAll(async () => {
    await storage.model.deleteMany({ fullName: new RegExp('mongo_test', 'i') })
  })

  it('Should monogo connect', async () => {
    expect(mongoose.connection.readyState).toBeTruthy()
  })

  it('Should addUser user', async () => {
    let res = await storage.addUser(testUser)
    expect(res).toBeTruthy()
  })

  it('Should updateUser user', async () => {
    let res = await storage.updateUser({ identifier: testUser.identifier, jwt: 'test jwt' })
    expect(res).toBeTruthy()

    let user = await storage.getByIdentifier(testUser.identifier)
    expect(user).toBeTruthy()

    const userDb = _.pick(user, _.keys(testUser))

    expect(user.jwt === 'test jwt').toBeTruthy()
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUserField user', async () => {
    let email = await storage.getUserField(testUser.identifier, 'email')
    expect(email === testUser.email).toBeTruthy()
  })

  it('Should getByIdentifier user', async () => {
    let user = await storage.getByIdentifier(testUser.identifier)
    const userDb = _.pick(user, _.keys(testUser))
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUser user', async () => {
    let user = await storage.getUser(testUser.identifier)
    const userDb = _.pick(user, _.keys(testUser))
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getByIdentifier unidentified identifier', async () => {
    let user = await storage.getByIdentifier('unidentified identifier')
    expect(user).not.toBeTruthy()
  })

  it('Should isDupUserData bu email', async () => {
    let isDupUser = await storage.isDupUserData({ email: testUser.email })
    expect(isDupUser).toBeTruthy()
  })

  it('Should isDupUserData bu email(is dup) and mobile(not is dup)', async () => {
    let isDupUser = await storage.isDupUserData({ email: testUser.email, mobile: '321987' })
    expect(isDupUser).toBeTruthy()
  })

  it('Should isDupUserData bu email(is not dup) and mobile(is dup)', async () => {
    let isDupUser = await storage.isDupUserData({ email: 'asdd@sdd.dd', mobile: testUser.mobile })
    expect(isDupUser).toBeTruthy()
  })

  it('Should is not dublicate by email', async () => {
    let isDupUser = await storage.isDupUserData({ email: 'test@tst.ss' })
    expect(isDupUser).not.toBeTruthy()
  })

  it('Should isDupUserData by mobile', async () => {
    let isDupUser = await storage.isDupUserData({ mobile: testUser.mobile })
    expect(isDupUser).toBeTruthy()
  })

  it('Should is not dublicate by mobile', async () => {
    let isDupUser = await storage.isDupUserData({ mobile: '987654' })
    expect(isDupUser).not.toBeTruthy()
  })

  it('Should getUserByEmail', async () => {
    let user = await storage.getUserByEmail(testUser.email)
    expect(user).toBeTruthy()
    const userDb = _.pick(user, _.keys(testUser))
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUserByMobile', async () => {
    let user = await storage.getUserByMobile(testUser.mobile)
    expect(user).toBeTruthy()
  })

  it('Should getUserByEmail bad req', async () => {
    let user = await storage.getUserByEmail('asdd@sdd.dd')
    expect(user).not.toBeTruthy()
  })

  it('Should getUserByMobile bad req', async () => {
    let user = await storage.getUserByMobile('987')
    expect(user).not.toBeTruthy()
  })

  it('Should delete user', async () => {
    let result = await storage.deleteUser(testUser)
    expect(result).toBeTruthy()
    let user = await storage.getByIdentifier(testUser.identifier)
    expect(user).not.toBeTruthy()
  })

  it('Should getList', async () => {
    const listUsers = [
      { identifier: '01', fullName: 'mongo_test1', email: 'test1@test.test', mobile: '1234567891' },
      { identifier: '02', fullName: 'mongo_test2', email: 'test2@test.test', mobile: '1234567892' },
      { identifier: '03', fullName: 'mongo_test3', email: 'test3@test.test', mobile: '1234567893' }
    ]

    for (let i in listUsers) {
      let res = await storage.addUser(listUsers[i])
      expect(res).toBeTruthy()
    }

    let users = await storage.listUsers()

    expect(users.length >= listUsers.length).toBeTruthy()
  })
})

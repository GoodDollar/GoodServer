/**
 * @jest-environment node
 */
import storage from '../mongo/user-privat-provider'
import mongoose from '../mongo-db'
import { pick, keys } from 'lodash'

import { DelayedTaskStatus } from '../mongo/models/delayed-task'

const testUserName = 'mongo_test'
const testTaskName = 'mongo_test'
const testTaskSubject = 'test_subject'
const testUser = { identifier: '00', fullName: testUserName, email: 'test@test.test', mobile: '123456789' }

jest.setTimeout(30000)

describe('UserPrivate', () => {
  const { model: userModel, taskModel } = storage

  const testTasksExists = async isExists =>
    expect(taskModel.exists({ taskName: testTaskName, subject: testTaskSubject })).resolves.toBe(isExists)

  // check if result obtained from raw query is the same like from storage method
  const testHasTasksQueued = async () =>
    storage.hasTasksQueued(testTaskName, { subject: testTaskSubject }).then(testTasksExists)

  const testTaskStatusSwitch = async status => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    await storage.fetchTasksForProcessing(testTaskName)

    switch (status) {
      case DelayedTaskStatus.Complete:
        await storage.completeDelayedTasks([_id])
        break
      case DelayedTaskStatus.Failed:
        await storage.failDelayedTasks([_id])
        break
      default:
        break
    }

    await expect(taskModel.find({ taskName: testTaskName })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status,
          lockId: null
        })
      ])
    )
  }

  beforeEach(async () => {
    await taskModel.deleteMany({ taskName: testTaskName })
  })

  afterAll(async () => {
    await userModel.deleteMany({ fullName: new RegExp(testUserName, 'i') })
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

    const userDb = pick(user, keys(testUser))

    expect(user.jwt === 'test jwt').toBeTruthy()
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUserField user', async () => {
    let email = await storage.getUserField(testUser.identifier, 'email')
    expect(email === testUser.email).toBeTruthy()
  })

  it('Should getByIdentifier user', async () => {
    let user = await storage.getByIdentifier(testUser.identifier)
    const userDb = pick(user, keys(testUser))
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUser user', async () => {
    let user = await storage.getUser(testUser.identifier)
    const userDb = pick(user, keys(testUser))
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getByIdentifier unidentified identifier', async () => {
    let user = await storage.getByIdentifier('unidentified identifier')
    expect(user).not.toBeTruthy()
  })

  it('Should not duplicate by email', async () => {
    let isDupUser = await storage.isDupUserData({ email: testUser.email })
    expect(isDupUser).not.toBeTruthy()
  })

  it('Should not duplicate by mobile', async () => {
    let isDupUser = await storage.isDupUserData({ mobile: testUser.mobile })
    expect(isDupUser).not.toBeTruthy()
  })

  it('Should updateUser user add createdDate', async () => {
    let res = await storage.updateUser({ identifier: testUser.identifier, createdDate: new Date().toString() })
    expect(res).toBeTruthy()
  })

  it('Should isDupUserData by email', async () => {
    let isDupUser = await storage.isDupUserData({ email: testUser.email })
    expect(isDupUser).toBeTruthy()
  })

  it('Should isDupUserData by email(is dup) and mobile(not is dup)', async () => {
    let isDupUser = await storage.isDupUserData({ email: testUser.email, mobile: '321987' })
    expect(isDupUser).toBeTruthy()
  })

  it('Should isDupUserData by email(is not dup) and mobile(is dup)', async () => {
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
    const userDb = pick(user, keys(testUser))
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

  it('Should add delayed task', async () => {
    await testTasksExists(false)

    const wrappedResponse = expect(storage.enqueueTask(testTaskName, testTaskSubject)).resolves

    await wrappedResponse.toHaveProperty('_id')
    await wrappedResponse.toHaveProperty('subject', testTaskSubject)
    await wrappedResponse.toHaveProperty('taskName', testTaskName)
    await testTasksExists(true)
  })

  it('Should check tasks for existence', async () => {
    await expect(storage.hasTasksQueued(testTaskName, { subject: testTaskSubject })).resolves.toBeBoolean()

    // check before add (both raw query and hasTasksQueued() should return false)
    await testHasTasksQueued()

    await storage.enqueueTask(testTaskName, testTaskSubject)
    // check before add (both raw query and hasTasksQueued() should return true)
    await testHasTasksQueued()
  })

  it('Should fetch tasks', async () => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    const wrappedResponse = expect(storage.fetchTasksForProcessing(testTaskName)).resolves

    await wrappedResponse.toBeArrayOfSize(1)

    await wrappedResponse.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id,
          taskName: testTaskName,
          subject: testTaskSubject
        })
      ])
    )
  })

  it('Should lock tasks fetched', async () => {
    await storage.enqueueTask(testTaskName, testTaskSubject)

    // this call locks the tasks found and should set running status
    await expect(storage.fetchTasksForProcessing(testTaskName)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: DelayedTaskStatus.Running,
          lockId: expect.anything()
        })
      ])
    )

    // so calling fetchTasksForProcessing() again should return empty list
    await expect(storage.fetchTasksForProcessing(testTaskName)).resolves.toBeArrayOfSize(0)
  })

  it('Should complete or fail tasks', async () => {
    await testTaskStatusSwitch(DelayedTaskStatus.Complete)
    await taskModel.deleteMany({ taskName: testTaskName })
    await testTaskStatusSwitch(DelayedTaskStatus.Failed)
  })

  it('Should unlock failed tasks', async () => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    await storage.fetchTasksForProcessing(testTaskName)
    // this unlock running tasks
    await storage.failDelayedTasks([_id])

    // so the next fetchTasksForProcessing() call now should return tasks
    await expect(storage.fetchTasksForProcessing(testTaskName)).resolves.toBeArrayOfSize(1)
  })

  it("Complete/fail shouldn't switch pending status", async () => {
    const { Complete, Failed } = DelayedTaskStatus
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    // we sholdn't be able to update status for task aren't locked via fetchTasksForProcessing()
    await storage.failDelayedTasks([_id])
    await storage.completeDelayedTasks([_id])

    // no complete/failed tasks should be found despite we've called corresponding storage methods
    await expect(
      taskModel.find({ taskName: testTaskName, status: { $in: [Complete, Failed] } })
    ).resolves.toBeArrayOfSize(0)
  })

  it('Should remove delayed tasks', async () => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    await testTasksExists(true)
    await storage.fetchTasksForProcessing(testTaskName)

    await expect(storage.removeDelayedTasks([_id])).resolves.toBeUndefined()
    await testTasksExists(false)
  })

  it("Shouldn't remove pending tasks", async () => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    await testTasksExists(true)
    await storage.removeDelayedTasks([_id])
    await testTasksExists(true)
  })
})

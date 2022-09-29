/**
 * @jest-environment node
 */
import storage from '../mongo/user-privat-provider'
import mongoose from '../mongo-db'
import { pick, keys } from 'lodash'

import DelayedTaskModel, { DelayedTaskStatus } from '../mongo/models/delayed-task'

const testUserName = 'mongo_test'
const testTaskName = 'mongo_test'
const testTaskSubject = 'test_subject'
const testUser = { identifier: '00', fullName: testUserName, email: 'test@test.test', mobile: '123456789' }

describe('UserPrivate', () => {
  const { model: userModel, taskModel } = storage

  const testUsersCleanup = async () => userModel.deleteMany({ fullName: new RegExp(testUserName, 'i') })

  const testUserAddCreateDate = async () =>
    await storage.updateUser({ identifier: testUser.identifier, createdDate: new Date().toString() })

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
        await storage.unlockDelayedTasks([_id])
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
    await testUsersCleanup()
    await storage.addUser(testUser)
  })

  it('Should mongo connect', async () => {
    expect(mongoose.connection.readyState).toBeTruthy()
  })

  it('Should addUser user', async () => {
    await testUsersCleanup()
    await expect(storage.addUser(testUser)).resolves.toBeTruthy()
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
    let res = await testUserAddCreateDate()

    expect(res).toBeTruthy()
  })

  it('Should isDupUserData by email if createdDate set', async () => {
    await testUserAddCreateDate()
    await expect(storage.isDupUserData({ email: testUser.email })).resolves.toBeTruthy()
  })

  it('Should isDupUserData by email(is dup) and mobile(not is dup)', async () => {
    await testUserAddCreateDate()
    await expect(storage.isDupUserData({ email: testUser.email, mobile: '321987' })).resolves.toBeTruthy()
  })

  it('Should isDupUserData by email(is not dup) and mobile(is dup)', async () => {
    await testUserAddCreateDate()
    await expect(storage.isDupUserData({ email: 'asdd@sdd.dd', mobile: testUser.mobile })).resolves.toBeTruthy()
  })

  it('Should is not dublicate by email', async () => {
    let isDupUser = await storage.isDupUserData({ email: 'test@tst.ss' })

    expect(isDupUser).not.toBeTruthy()
  })

  it('Should isDupUserData by mobile', async () => {
    await testUserAddCreateDate()
    await expect(storage.isDupUserData({ mobile: testUser.mobile })).resolves.toBeTruthy()
  })

  it('Should is not dublicate by mobile', async () => {
    let isDupUser = await storage.isDupUserData({ mobile: '987654' })

    expect(isDupUser).not.toBeTruthy()
  })

  it('Should getUserByEmail', async () => {
    const [user] = await storage.getUsersByEmail(testUser.email)
    const userDb = pick(user, keys(testUser))

    expect(user).toBeTruthy()
    expect(userDb).toMatchObject(testUser)
  })

  it('Should getUserByMobile', async () => {
    const [user] = await storage.getUsersByMobile(testUser.mobile)

    expect(user).toBeTruthy()
  })

  it('Should getUserByEmail bad req', async () => {
    const [user] = await storage.getUsersByEmail('asdd@sdd.dd')

    expect(user).not.toBeTruthy()
  })

  it('Should getUserByMobile bad req', async () => {
    const [user] = await storage.getUsersByMobile('987')

    expect(user).not.toBeTruthy()
  })

  it('Should delete user', async () => {
    const result = await storage.deleteUser(testUser)
    const user = await storage.getByIdentifier(testUser.identifier)

    expect(result).toBeTruthy()
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

  it('Should cancel an enqueued task', async () => {
    // check before add (both raw query and hasTasksQueued() should return false)
    await testHasTasksQueued()
    // enqueue task to cancel
    await storage.enqueueTask(testTaskName, testTaskSubject)
    // find enqueued task
    const enqueuedTaskBeforeCancel = await DelayedTaskModel.findOne({ taskName: testTaskName })
    // assert that enqueued task exists
    expect(enqueuedTaskBeforeCancel).toBeObject()
    // cancel enqueued task
    await storage.cancelTasksQueued(testTaskName, { subject: testTaskSubject })
    // find enqueued task
    const enqueuedTaskAfterCancel = await DelayedTaskModel.findOne({ taskName: testTaskName })
    // assert enqueued task doesn't exist'
    expect(enqueuedTaskAfterCancel).toBeNull()
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
          status: DelayedTaskStatus.Locked,
          lockId: expect.anything()
        })
      ])
    )

    // so calling fetchTasksForProcessing() again should return empty list
    await expect(storage.fetchTasksForProcessing(testTaskName)).resolves.toBeArrayOfSize(0)
  })

  it('Should complete/fail/unlock tasks', async () => {
    await testTaskStatusSwitch(DelayedTaskStatus.Complete)
    await taskModel.deleteMany({ taskName: testTaskName })
    await testTaskStatusSwitch(DelayedTaskStatus.Failed)
    await taskModel.deleteMany({ taskName: testTaskName })
    await testTaskStatusSwitch(DelayedTaskStatus.Pending)
  })

  it('Should unlock tasks also by the filters', async () => {
    await storage.enqueueTask(testTaskName, testTaskSubject)
    await storage.fetchTasksForProcessing(testTaskName)
    await storage.unlockDelayedTasks(testTaskName)

    await expect(taskModel.find({ taskName: testTaskName })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: DelayedTaskStatus.Pending,
          lockId: null
        })
      ])
    )
  })

  it('Should unlock failed tasks', async () => {
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    await storage.fetchTasksForProcessing(testTaskName)
    // this unlock running tasks
    await storage.failDelayedTasks([_id])

    // so the next fetchTasksForProcessing() call now should return tasks
    await expect(storage.fetchTasksForProcessing(testTaskName)).resolves.toBeArrayOfSize(1)
  })

  it("Complete/fail/update shouldn't switch pending status", async () => {
    const { Complete, Failed } = DelayedTaskStatus
    const { _id } = await storage.enqueueTask(testTaskName, testTaskSubject)

    // we shouldn't be able to update status for task aren't locked via fetchTasksForProcessing()
    await storage.failDelayedTasks([_id])
    await storage.completeDelayedTasks([_id])
    await storage.unlockDelayedTasks([_id])

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

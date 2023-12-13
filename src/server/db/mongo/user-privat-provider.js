//@flow
import { v4 as uuidv4 } from 'uuid'
import { get, isArray, isBoolean, isString } from 'lodash'

import UserPrivateModel from './models/user-private'
import DelayedTaskModel, { DelayedTaskStatus } from './models/delayed-task'
import logger from '../../../imports/logger'

import { type UserRecord, type DelayedTaskRecord } from '../../../imports/types'

class UserPrivate {
  constructor(model, taskModel, logger) {
    this.logger = logger

    this.model = model
    this.taskModel = taskModel
  }

  /**
   * Is duplicate User
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<*>}
   */
  async isDupUserData(user: UserRecord): boolean {
    const { model } = this
    const { email, mobile } = user
    const dateFilter = { createdDate: { $exists: true } }

    if (email) {
      return model.exists({ email, ...dateFilter })
    }

    if (mobile) {
      return model.exists({ mobile, ...dateFilter })
    }

    return false
  }

  /**
   * Create or update user private date
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<void>}
   */
  async updateUser(user: UserRecord): Promise<boolean> {
    const { logger, model } = this

    try {
      await model.updateOne({ identifier: user.identifier }, { $set: user }, { upsert: true })

      return true
    } catch (ex) {
      logger.error('Update user failed [mongo actions]:', ex.message, ex, { user })
      throw ex
    }
  }

  /**
   * Add new user
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<boolean>}
   */
  async addUser(user: UserRecord): Promise<boolean> {
    return this.updateUser(user)
  }

  /**
   * Return row by field and value
   *
   * @param {string} identifier
   * @param {string} field
   *
   * @returns {object || null}
   */
  async getUserField(identifier: string, field: string): string {
    const result = await this.model
      .findOne({ identifier })
      .select(field)
      .lean()

    return result ? result[field] : ''
  }

  /**
   * Return data by identifier
   *
   * @param {int} identifier
   *
   * @returns {object || null}
   */
  async getByIdentifier(identifier) {
    return await this.model.findOne({ identifier }).lean()
  }

  /**
   * complete Step by identifier and step name
   *
   * @param {int} identifier
   * @param {string} stepName
   *
   * @returns {object || null}
   */
  async completeStep(identifier, stepName) {
    const field = `isCompleted.${stepName}`

    await this.model.updateOne({ identifier }, { $set: { [field]: true } })

    return true
  }

  /**
   * Delete user by identifier
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<*>}
   */
  async deleteUser(user: UserRecord): boolean {
    try {
      await this.model.deleteOne({ identifier: user.identifier })
      return true
    } catch (ex) {
      logger.error('Delete user failed [mongo actions]:', ex.message, ex, { user })
      return false
    }
  }

  /**
   * Get user by email
   *
   * @param {string} email
   *
   * @returns {Promise<*>}
   */
  async getUsersByEmail(email: string): Promise<UserRecord> {
    return await this.model.find({ email }).lean()
  }

  /**
   * Get user
   *
   * @param {string} mobile
   *
   * @returns {Promise<*>}
   */
  async getUsersByMobile(mobile: string): Promise<UserRecord> {
    return await this.model.find({ mobile }).lean()
  }

  /**
   * Get list users
   *
   * @returns {Promise<*>}
   */
  async listUsers(fields: any = {}): Promise<UserRecord> {
    return await this.model.find({}, { email: 1, identifier: 1, ...fields }).lean()
  }

  /**
   * Get user by identifier
   *
   * @param {string} identifier
   *
   * @returns {Promise<*>}
   */
  async getUser(identifier: string): Promise<UserRecord> {
    return await this.getByIdentifier(identifier)
  }

  /**
   * Get users with crmId, so we know if we can delete crm record if only 1 record exists
   *
   * @param {string} identifier
   *
   * @returns {Promise<*>}
   */
  async getCountCRMId(crmId: number): Promise<number> {
    return await this.model.countDocuments({ crmId })
  }

  async getTask(taskName, filters): Promise<DelayedTaskRecord> {
    const { taskModel } = this
    return taskModel.findOne({ taskName, ...filters })
  }
  /**
   * Enqueue delayed task to the user's tasks queue
   *
   * @param {string} userIdentifier
   * @param {string} taskName
   * @param {any} subject
   */
  async enqueueTask(taskName: string, subject?: any, user?: UserRecord): Promise<DelayedTaskRecord> {
    const { taskModel, logger } = this
    // using mongo's _id to keep relationship between user & task models
    const userIdentifier = get(user, '_id')

    try {
      return await taskModel.create({ userIdentifier, taskName, subject })
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { taskName, userIdentifier, subject }

      logger.error("Couldn't enqueue task", errMessage, exception, logPayload)
      throw exception
    }
  }

  /**
   * Checks if there exists tasks of the type specified and matching optional filters
   * @param {string} taskName
   * @param {object} filters
   */
  async hasTasksQueued(taskName: string, filters: object = {}): Promise<boolean> {
    const { taskModel } = this

    return taskModel.exists({ ...filters, taskName }).then(Boolean)
  }

  /**
   * cancel queued task
   * @param {string} taskName
   * @param {object} filters
   */
  async cancelTasksQueued(taskName: string, filters: object = {}): Promise<void> {
    const { taskModel } = this

    await taskModel.deleteOne({ ...filters, taskName })
  }

  /**
   * Fetches tasks of the type specified with optional filtering and locks them by setting running status
   *
   * @param {string} taskName
   * @param {object} filters
   */
  async fetchTasksForProcessing(taskName: string, filters: object = {}): Promise<DelayedTaskRecord[]> {
    const lockId = uuidv4()
    const { taskModel, logger } = this
    const { Locked, Complete } = DelayedTaskStatus

    try {
      await taskModel.updateMany(
        // selecting tasks which aren't locked or completed by taskName and other filters
        { ...filters, status: { $nin: [Locked, Complete] }, taskName },
        // setting unique (for each fetchTasksForProcessing() call) lockId
        { status: Locked, lockId }
      )

      // queries aren't Promises in mongoose so we couldn't just
      // return taskModel.find() - this may cause extra queries
      // so we're getting result collection and returning it manually
      // @see https://mongoosejs.com/docs/queries.html#queries-are-not-promises
      //
      // here we just fetching records matched by unique (for each call) lockId
      // there should be the same records were locked during .updateMany query
      const pendingTasks = await taskModel.find({ lockId })

      return pendingTasks
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { filters, taskName }

      logger.error("Couldn't fetch & lock tasks for processing", errMessage, exception, logPayload)
      throw exception
    }
  }

  /**
   * Unlocks delayed tasks in the queue
   *
   * @param {string[]} tasksIdentifiers
   */
  async unlockDelayedTasks(taskNameOrIdentifiers: string | string[], filters: object = {}): Promise<void> {
    const taskName = taskNameOrIdentifiers
    const { Pending } = DelayedTaskStatus

    if (isArray(taskNameOrIdentifiers)) {
      return this._unlockTasks(taskNameOrIdentifiers)
    }

    if (!isString(taskName)) {
      return
    }

    await this._unlockTasksBy({ ...filters, taskName }, Pending)
  }

  /**
   * Unlocks delayed tasks in the queue and marks them as completed
   *
   * @param {string[]} tasksIdentifiers
   */
  async completeDelayedTasks(tasksIdentifiers: string[]): Promise<void> {
    await this._unlockTasks(tasksIdentifiers, true)
  }

  /**
   * Unlocks delayed tasks in the queue and marks them as failed
   *
   * @param {string[]} tasksIdentifiers
   */
  async failDelayedTasks(tasksIdentifiers: string[]): Promise<void> {
    await this._unlockTasks(tasksIdentifiers, false)
  }

  /**
   * Removes delayed tasks from the queue
   *
   * @param {string[]} tasksIdentifiers
   */
  async removeDelayedTasks(tasksIdentifiers: string[]): Promise<void> {
    const { taskModel, logger } = this
    const { Locked, Complete } = DelayedTaskStatus

    try {
      await taskModel.deleteMany({ status: { $in: [Locked, Complete] }, _id: { $in: tasksIdentifiers } })
    } catch (exception) {
      const { message: errMessage } = exception
      const logPayload = { tasksIdentifiers }

      logger.error("Couldn't remove delayed tasks", errMessage, exception, logPayload)
      throw exception
    }
  }

  /**
   * @private
   */
  async _unlockTasks(tasksIdentifiers: string[], tasksSucceeded: boolean = null): Promise<void> {
    const { Complete, Failed, Pending } = DelayedTaskStatus
    let unlockedStatus = Pending

    if (isBoolean(tasksSucceeded)) {
      unlockedStatus = tasksSucceeded ? Complete : Failed
    }

    await this._unlockTasksBy({ _id: { $in: tasksIdentifiers } }, unlockedStatus)
  }

  /**
   * @private
   */
  async _unlockTasksBy(filters: object, newStatus: string): Promise<void> {
    const { taskModel, logger } = this
    const { Locked } = DelayedTaskStatus

    try {
      await taskModel.updateMany({ ...filters, status: Locked }, { status: newStatus, lockId: null })
    } catch (exception) {
      const { message: errMessage } = exception

      logger.error("Couldn't unlock and update delayed tasks", errMessage, exception, filters)
      throw exception
    }
  }
}

export default new UserPrivate(UserPrivateModel, DelayedTaskModel, logger.child({ from: 'UserDBPrivate' }))

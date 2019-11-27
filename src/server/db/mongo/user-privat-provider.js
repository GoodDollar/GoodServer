// @flow
import UserPrivateModel from './models/user-private.js'
import logger from '../../../imports/pino-logger'
import { type UserRecord } from '../../../imports/types'

class UserPrivate {
  constructor() {
    this.model = UserPrivateModel
  }

  /**
   * Is dublicate User
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<*>}
   */
  async isDupUserData(user: UserRecord): boolean {
    const { email, mobile } = user
    let result = null

    if (email) {
      result = await this.model
        .findOne({ email })
        .select('_id')
        .lean()
      if (result) {
        return true
      }
    }

    if (mobile) {
      result = await this.model
        .findOne({ mobile })
        .select('_id')
        .lean()
      if (result) {
        return true
      }
    }

    return false
  }

  /**
   * Create or update user privat date
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<void>}
   */
  async updateUser(user: UserRecord): Promise<boolean> {
    try {
      await this.model.updateOne({ identifier: user.identifier }, { $set: user }, { upsert: true })
      return true
    } catch (ex) {
      logger.error('Update user failed [mongo actions]:', { message: ex.message, user })
    }

    return false
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
      logger.error('Delete user failed [mongo actions]:', { message: ex.message, user })
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
  async getUserByEmail(email: string): Promise<UserRecord> {
    return await this.model.findOne({ email }).lean()
  }

  /**
   * Get user
   *
   * @param {string} mobile
   *
   * @returns {Promise<*>}
   */
  async getUserByMobile(mobile: string): Promise<UserRecord> {
    return await this.model.findOne({ mobile }).lean()
  }

  /**
   * Get list users
   *
   * @returns {Promise<*>}
   */
  async listUsers(): Promise<UserRecord> {
    return await this.model.find().lean()
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
}

export default new UserPrivate()

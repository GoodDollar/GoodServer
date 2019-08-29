import UserPrivateModel from './models/user-private.js'
import logger from '../../../imports/pino-logger'
import { type UserRecord } from '../../../imports/types'

class UserPrivate {
  constructor() {
    this.model = UserPrivateModel
  }

  /**
   * Get new nonce after increment
   *
   * @param {UserRecord} user
   *
   * @returns {Promise<*>}
   */
  async isDupUserData(user: UserRecord): boolean {
    const { email, mobile } = user
    let result = null

    if (email) {
      result = await this.model.findOne({ email })
      if (result) {
        return true
      }
    }

    if (mobile) {
      result = await this.model.findOne({ mobile })
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
      const userDb = await this.getByIdentifier(user.identifier)
      if (userDb) {
        await this.model.update({ identifier: user.identifier }, { $set: user }, { new: true })
      } else {
        await this.model.create(user)
      }
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
    const result = await this.model.findOne({ identifier })

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
    return await this.model.findOne({ identifier })
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
    return await this.model.findOne({ email })
  }

  /**
   * Get user
   *
   * @param {string} mobile
   *
   * @returns {Promise<*>}
   */
  async getUserByMobile(mobile: string): Promise<UserRecord> {
    return await this.model.findOne({ mobile })
  }

  /**
   * Get list users
   *
   * @returns {Promise<*>}
   */
  async listUsers(): Promise<UserRecord> {
    return await this.model.find()
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

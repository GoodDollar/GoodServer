//@flow
import { sha3 } from 'web3-utils'
import UserPrivateModel from './models/user-private.js'
import PropsModel from './models/props.js'
import { get } from 'lodash'
import logger from '../../../imports/logger'
import { type UserRecord } from '../../../imports/types'

class UserPrivate {
  constructor() {
    this.model = UserPrivateModel
    this.upgrade()
      .then(_ => logger.info('upgrade done'))
      .catch(e => logger.error('upgrade failed', { err: e.message, e }))
  }

  async upgrade() {
    const dbversion = await PropsModel.findOne({ name: 'DATABASE_VERSION' })
    console.log(dbversion)
    const version = get(dbversion, 'value.version', 0)
    if (version < 1) {
      const docs = await UserPrivateModel.find()
      const ops = docs
        .filter(doc => doc.email || doc.mobile)
        .filter(doc => (doc.email && doc.email.indexOf('0x') === -1) || (doc.mobile && doc.mobile.indexOf('0x') === -1))
        .map(doc => {
          const res = {
            updateOne: {
              filter: { _id: doc._id },
              update: { mobile: doc.mobile && sha3(doc.mobile), email: doc.email && sha3(doc.email), otp: null }
            }
          }
          return res
        })
      const res = await UserPrivateModel.bulkWrite(ops)
      logger.info('upgrade v1', res)
      await PropsModel.updateOne({ name: 'DATABASE_VERSION' }, { $set: { value: { version: 1 } } }, { upsert: true })
    }
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
        .findOne({ email, createdDate: { $exists: true } })
        .select('_id')
        .lean()
      if (result) {
        return true
      }
    }

    if (mobile) {
      result = await this.model
        .findOne({ mobile, createdDate: { $exists: true } })
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
  async listUsers(fields: any = {}): Promise<UserRecord> {
    const res = this.model.find({}, { email: 1, identifier: 1, ...fields }).lean()
    return res
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

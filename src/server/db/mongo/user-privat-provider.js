import UserPrivateModel from './models/user-private.js'
import logger from '../../../imports/pino-logger'

class UserPrivate {
  
  constructor() {
    this.model = UserPrivateModel
  }

  /**
   * Get new nonce after increment
   *
   * @param {object} user
   *
   * @returns {Promise<*>}
   */
  async isDupUserData(user) {
    const {email, mobile} = user
    let result = null;
    
    if (email) {
      result = await this.model.findOne({ email });
      if (result) {
        return true;
      }
    }
    
    if (mobile) {
      result = await this.model.findOne({ mobile });
      if (result) {
        return true;
      }
    }
    
    return false
  }

  /**
   * Create or update user privat date
   *
   * @param {int} identifier
   * @param {object} user
   *
   * @returns {Promise<void>}
   */
  async createOrUpdate(identifier, user) {
    
    try {
      if (await this.getByIdentifier(identifier)) {
        await this.model.findOneAndUpdate(
          { identifier },
          {
            email: user.email || null,
            mobile: user.mobile.replace(/[_+-\s]+/g, '') || null,
          }
        )
      } else {
        await this.model.create({
          identifier,
          email: user.email || null,
          mobile: user.mobile.replace(/[_+-\s]+/g, '') || null,
        })
      }
      
    } catch (ex) {
      logger.error('Update user failed [mongo actions]:', { message: ex.message, user })
    }
    
  }
  
  
  /**
   * Return row by field and value
   *
   * @param {string} field
   *
   * @returns {object || null}
   */
  async getByFieldValue(field, value) {
    console.log(field, value)
    const result = await this.model.findOne({ [field]: new RegExp(value, 'i')});

    return result;
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
   * @param {int} identifier
   *
   * @returns {Promise<*>}
   */
  async delete(identifier) {
    await this.model.deleteOne({ identifier })
    
    return true;
  }
  
}

export default new UserPrivate()

// @flow
import { pick, get } from 'lodash'
import conf from '../server.config'

import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import OnGage from '../crm/ongage'

import { parseUtmString } from '../utils/request'
import { type UserRecord } from '../../imports/types'

export const addUserToWhiteList = async (userRecord: UserRecord, logger: any) => {
  if (!conf.disableFaceVerification) {
    return
  }

  const user = await UserDBPrivate.getUser(userRecord.identifier)
  const whiteList = get(user, 'isCompleted.whiteList', false)

  if (whiteList) {
    logger.debug('addUserToWhiteList user already whitelisted', { address: userRecord.gdAddress })
    return true
  }

  logger.debug('addUserToWhiteList whitelisting user...', {
    address: userRecord.gdAddress,
    identifier: userRecord.identifier
  })

  try {
    await AdminWallet.whitelistUser(userRecord.gdAddress, userRecord.profilePublickey)
    await UserDBPrivate.completeStep(userRecord.identifier, 'whiteList')

    logger.debug('addUserToWhiteList user whitelisted success', { address: userRecord.gdAddress })
    return true
  } catch (exception) {
    const { message: errMessage } = exception

    logger.warn('addUserToWhiteList failed whitelisting', errMessage, exception, { userRecord })
    return false
  }
}

export const createCRMRecord = async (userRecord: UserRecord, utmString: string, logger: any) => {
  const userFields = pick(userRecord, ['fullName', 'mobile', 'email', 'identifier', 'regMethod', 'torusProvider'])

  const utmFields = parseUtmString(utmString)
  const nameParts = get(userFields, 'fullName', '').split(' ')
  const firstName = nameParts[0]
  const lastName = nameParts.length > 1 ? nameParts.pop() : ''

  const fieldsForCRM = {
    firstName,
    lastName,
    ...userFields,
    ...utmFields
  }

  logger.debug('createCRMRecord utm:', { utmString, utmFields })
  let crmId = await OnGage.createContact(fieldsForCRM, logger).catch(e => {
    logger.error('createCRMRecord Create CRM Record Failed', e.message, e, { fieldsForCRM, userRecord })
    throw e
  })

  crmId = crmId || userRecord.crmId

  await UserDBPrivate.updateUser({ identifier: userRecord.identifier, crmId })
  logger.debug('createCRMRecord user crm record updated', { fieldsForCRM, userRecord, crmId })

  return crmId
}

export const topUserWallet = async (userRecord: UserRecord, logger: any) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  const topWallet = get(user, 'isCompleted.topWallet', false)
  if (!topWallet) {
    return AdminWallet.topWallet(userRecord.gdAddress)
      .then(r => {
        UserDBPrivate.completeStep(userRecord.identifier, 'topWallet')
        logger.debug('topUserWallet success', { address: userRecord.gdAddress })
        return true
      })
      .catch(e => {
        logger.error('New user topping failed', e.message, e, { userRecord })
        return false
      })
  }
  logger.debug('topUserWallet user wallet already topped', { address: userRecord.gdAddress })
  return true
}

export const syncUserEmail = async (user, email, utmString, log) => {
  const { crmId } = user

  if (!crmId) {
    const userPayload = { ...user, email }

    log.debug("crm contact doesn't exists creating...")
    await createCRMRecord(userPayload, utmString, log)
    return
  }

  log.debug('crm contact exists updating...')
  await OnGage.updateContactEmail(crmId, email, log)
}

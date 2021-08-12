// @flow
import { pick, get } from 'lodash'
import conf from '../server.config'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import { type UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'

const addUserToWhiteList = async (userRecord: UserRecord, logger: any) => {
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

const updateMauticRecord = async (userRecord: UserRecord, utmString: string, logger: any) => {
  const userFields = pick(userRecord, ['fullName', 'mobile', 'email', 'identifier', 'regMethod', 'torusProvider'])

  const utmFields = Mautic.parseUtmString(utmString)
  const nameParts = get(userFields, 'fullName', '').split(' ')
  const firstName = nameParts[0]
  const lastName = nameParts.length > 1 && nameParts.pop()

  const fieldsForMautic = {
    firstName,
    lastName,
    ...userFields,
    ...utmFields
  }

  logger.debug('updateMauticRecord utm:', { utmString, utmFields })
  const mauticRecord = await Mautic.createContact(fieldsForMautic, logger).catch(e => {
    logger.error('updateMauticRecord Create Mautic Record Failed', e.message, e, { fieldsForMautic, userRecord })
    throw e
  })

  const mauticId = get(mauticRecord, 'contact.id', userRecord.mauticId)

  await UserDBPrivate.updateUser({ identifier: userRecord.identifier, mauticId })
  logger.debug('updateMauticRecord user mautic record updated', { fieldsForMautic, userRecord, mauticId, mauticRecord })

  return mauticId
}

const topUserWallet = async (userRecord: UserRecord, logger: any) => {
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

export default {
  topUserWallet,
  updateMauticRecord,
  addUserToWhiteList
}

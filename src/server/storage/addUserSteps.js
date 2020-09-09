// @flow
import { pick, get } from 'lodash'
import conf from '../server.config'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import { type UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
import W3Helper from '../utils/W3Helper'
import requestTimeout from '../utils/timeout'

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
    profile: userRecord.profilePublickey
  })

  try {
    await AdminWallet.whitelistUser(userRecord.gdAddress, userRecord.profilePublickey)
    await UserDBPrivate.completeStep(userRecord.identifier, 'whiteList')

    logger.debug('addUserToWhiteList user whitelisted success', { address: userRecord.gdAddress })
    return true
  } catch (exception) {
    const { message: errMessage } = exception

    logger.error('addUserToWhiteList failed whitelisting', errMessage, exception, { userRecord })
    return false
  }
}

const updateMauticRecord = async (userRecord: UserRecord, utmString: string, logger: any) => {
  const userFields = pick(userRecord, [
    'fullName',
    'mobile',
    'email',
    'identifier',
    'profilePublickey',
    'regMethod',
    'torusProvider'
  ])

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
  const mauticRecord = await Mautic.createContact(fieldsForMautic).catch(e => {
    logger.error('updateMauticRecord Create Mautic Record Failed', e.message, e, { fieldsForMautic, userRecord })
    throw e
  })

  const mauticId = get(mauticRecord, 'contact.id', userRecord.mauticId)

  await UserDBPrivate.updateUser({ identifier: userRecord.identifier, mauticId })
  logger.debug('updateMauticRecord user mautic record updated', { fieldsForMautic, userRecord, mauticId, mauticRecord })

  return true
}

const updateW3Record = async (user: any, logger: any) => {
  if (conf.env !== 'test' && conf.enableInvites === false) {
    return
  }
  let userDB = await UserDBPrivate.getUser(user.identifier)
  const w3Record = get(userDB, 'isCompleted.w3Record', false)
  if (!w3Record) {
    const web3Record = await W3Helper.registerUser(user).catch(e => {
      logger.error('updateW3Record error registering user to w3', e.message, e, { user })
    })
    if (web3Record && web3Record.login_token && web3Record.wallet_token) {
      await UserDBPrivate.updateUser({
        identifier: user.identifier,
        loginToken: web3Record.login_token,
        w3Token: web3Record.wallet_token,
        'isCompleted.w3Record': true
      })
      logger.debug('updateW3Record got web3 user records', { web3Record, user })
    } else {
      logger.error('updateW3Record empty w3 response', '', null, { user })

      // supress error while running locally
      if (!conf.walletUrl.includes('localhost:')) {
        throw new Error('empty w3 response')
      }
    }
    return {
      loginToken: web3Record.login_token,
      w3Token: web3Record.wallet_token
    }
  }
  return userDB
}

const topUserWallet = async (userRecord: UserRecord, logger: any) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  const topWallet = get(user, 'isCompleted.topWallet', false)
  if (!topWallet) {
    return Promise.race([AdminWallet.topWallet(userRecord.gdAddress, null), requestTimeout(15000, 'topWallet')])
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
  updateW3Record,
  updateMauticRecord,
  addUserToWhiteList
}

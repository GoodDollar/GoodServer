// @flow
import conf from '../server.config'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import { type UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
import get from 'lodash/get'
import W3Helper from '../utils/W3Helper'
import { generateMarketToken } from '../utils/market'
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

    logger.error('addUserToWhiteList failed whitelisting', { e: exception, errMessage, userRecord })
    return false
  }
}

const updateMauticRecord = async (userRecord: UserRecord, logger: any) => {
  const mauticRecord = await Mautic.createContact(userRecord).catch(e => {
    logger.error('updateMauticRecord Create Mautic Record Failed', { e, errMessage: e.message, userRecord })
    throw e
  })
  const mauticId = get(mauticRecord, 'contact.id', userRecord.mauticId)
  await UserDBPrivate.updateUser({ identifier: userRecord.identifier, mauticId })
  logger.debug('updateMauticRecord user mautic record updated', { userRecord, mauticId, mauticRecord })

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
      logger.error('updateW3Record error registering user to w3', { e, errMessage: e.message, user })
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
      logger.error('updateW3Record empty w3 response', { user })

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

const updateMarketToken = async (user: any, logger: any) => {
  if (conf.env !== 'test' && conf.isEtoro === false) {
    return
  }

  let userDB = await UserDBPrivate.getUser(user.identifier)
  const marketToken = get(userDB, 'isCompleted.marketToken', false)
  if (!marketToken) {
    const marketToken = await generateMarketToken(user)
    logger.debug('generate new user market token:', { marketToken, user })
    if (marketToken) {
      await UserDBPrivate.updateUser({ identifier: user.identifier, marketToken, 'isCompleted.marketToken': true })
    }
    return marketToken
  }
  return userDB.marketToken
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
        logger.error('New user topping failed', { errMessage: e.message, userRecord })
        return false
      })
  }
  logger.debug('topUserWallet user wallet already topped', { address: userRecord.gdAddress })
  return true
}

export default {
  topUserWallet,
  updateMarketToken,
  updateW3Record,
  updateMauticRecord,
  addUserToWhiteList
}

// @flow
import conf from '../server.config'
import logger from '../../imports/logger'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import { type UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
import get from 'lodash/get'
import W3Helper from '../utils/W3Helper'
import { generateMarketToken } from '../utils/market'

const Timeout = (timeout: msec, msg: string) => {
  return new Promise((res, rej) => {
    setTimeout(rej, timeout, new Error(`Request Timeout: ${msg}`))
  })
}

const addUserToWhiteList = async (userRecord: UserRecord) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  const whiteList = get(user, 'isCompleted.whiteList', false)
  if (conf.disableFaceVerification && !whiteList) {
    return AdminWallet.whitelistUser(userRecord.gdAddress, userRecord.profilePublickey)
      .then(async r => {
        await UserDBPrivate.completeStep(user.identifier, 'whiteList')
        return true
      })
      .catch(e => {
        logger.error('failed whitelisting', e.message, e, { userRecord })
        return false
      })
  }
  return true
}

const updateMauticRecord = async (userRecord: UserRecord) => {
  if (!userRecord.mauticId) {
    const mauticRecord = await Mautic.createContact(userRecord).catch(e => {
      logger.error('Create Mautic Record Failed', { e })
      throw e
    })
    const mauticId = !userRecord.mauticId ? get(mauticRecord, 'contact.fields.all.id', -1) : userRecord.mauticId
    await UserDBPrivate.updateUser({ identifier: userRecord.identifier, mauticId })
    logger.debug('User mautic record', { mauticId, mauticRecord })
  }

  return true
}

const updateW3Record = async (user: any) => {
  if (conf.env !== 'test' && conf.enableInvites === false) {
    return
  }
  let userDB = await UserDBPrivate.getUser(user.identifier)
  const w3Record = get(userDB, 'isCompleted.w3Record', false)
  if (!w3Record) {
    const web3Record = await W3Helper.registerUser(user)
    if (web3Record && web3Record.login_token && web3Record.wallet_token) {
      await UserDBPrivate.updateUser({
        identifier: user.identifier,
        loginToken: web3Record.login_token,
        w3Token: web3Record.wallet_token,
        'isCompleted.w3Record': true
      })
      logger.debug('got web3 user records', { web3Record })
    }
    return {
      loginToken: web3Record.login_token,
      w3Token: web3Record.wallet_token
    }
  }
  return userDB
}

const updateMarketToken = async (user: any) => {
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

const topUserWallet = async (userRecord: UserRecord) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  const topWallet = get(user, 'isCompleted.topWallet', false)
  if (!topWallet) {
    return Promise.race([AdminWallet.topWallet(userRecord.gdAddress, null, true), Timeout(15000, 'topWallet')])
      .then(r => {
        UserDBPrivate.completeStep(userRecord.identifier, 'topWallet')
        return true
      })
      .catch(e => {
        logger.error('New user topping failed', { errMessage: e.message })
        return false
      })
  }
  return true
}

export default {
  topUserWallet,
  updateMarketToken,
  updateW3Record,
  updateMauticRecord,
  addUserToWhiteList
}

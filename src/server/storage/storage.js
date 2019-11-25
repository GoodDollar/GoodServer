// @flow
import conf from '../server.config'
import logger from '../../imports/pino-logger'
import AdminWallet from '../blockchain/AdminWallet'
import UserDBPrivate from '../db/mongo/user-privat-provider'
import { type UserRecord } from '../../imports/types'
import { Mautic } from '../mautic/mauticAPI'
import get from 'lodash/get'
import * as W3Helper from '../utils/W3Helper'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

const Timeout = (timeout: msec, msg: string) => {
  return new Promise((res, rej) => {
    setTimeout(rej, timeout, new Error(`Request Timeout: ${msg}`))
  })
}

export const addUserToWhiteList = async (userRecord: UserRecord) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  if (conf.disableFaceVerification && (!user.isCompleted || !user.isCompleted.whiteList)) {
    await AdminWallet.whitelistUser(userRecord.gdAddress, userRecord.profilePublickey)
      .then(async r => {
        await UserDBPrivate.completeStep(user.identifier, 'whiteList')
      })
      .catch(e => {
        logger.error('failed whitelisting', userRecord)
      })
  }
  return true
}

export const updateMauticRecord = async (userRecord: UserRecord) => {
  if (!userRecord.mauticId) {
    const mauticRecord = await Mautic.createContact(userRecord).catch(e => {
      logger.error('Create Mautic Record Failed', e)
    })
    const mauticId = !userRecord.mauticId ? get(mauticRecord, 'contact.fields.all.id', -1) : userRecord.mauticId
    await UserDBPrivate.updateUser({ identifier: userRecord.identifier, mauticId })
    logger.debug('User mautic record', { mauticId, mauticRecord })
  }

  return true
}

export const updateW3Record = async (user: any) => {
  let userDB = await UserDBPrivate.getUser(user.identifier)
  if (!userDB.isCompleted || !userDB.isCompleted.w3Record) {
    const web3Record = await W3Helper.registerUser(user)
    if (web3Record && web3Record.login_token && web3Record.wallet_token) {
      await UserDBPrivate.updateUser({
        identifier: user.identifier,
        loginToken: web3Record.login_token,
        w3Token: web3Record.wallet_token
      })
      await UserDBPrivate.completeStep(user.identifier, 'w3Record')
      logger.debug('got web3 user records', web3Record)
    }
    return web3Record
  }
  return null
}

export const updateMarketToken = async (user: any) => {
  let userDB = await UserDBPrivate.getUser(user.identifier)

  if (!userDB.isCompleted || !userDB.isCompleted.marketToken) {
    const marketToken = await generateMarketToken(user)
    logger.debug('generate new user market token:', { marketToken, user })
    if (marketToken) {
      await UserDBPrivate.updateUser({ identifier: user.identifier, marketToken })
      await UserDBPrivate.completeStep(user.identifier, 'marketToken')
    }
    return marketToken
  }
  return null
}

export const addUserToTopWallet = async (userRecord: UserRecord) => {
  let user = await UserDBPrivate.getUser(userRecord.identifier)
  if (!user.isCompleted || !user.isCompleted.topWallet) {
    return Promise.race([AdminWallet.topWallet(userRecord.gdAddress, null, true), Timeout(15000, 'topWallet')])
      .then(async r => {
        await UserDBPrivate.completeStep(user.identifier, 'topWallet')
        return { ok: 1 }
      })
      .catch(e => {
        logger.error('New user topping failed', e.message)
        return { ok: 0, error: 'New user topping failed' }
      })
  }
}

export const generateMarketToken = (user: UserRecord) => {
  const iv = crypto.randomBytes(16)
  const token = jwt.sign({ email: user.email, name: user.fullName }, conf.marketPassword)
  const cipher = crypto.createCipheriv('aes-256-cbc', conf.marketPassword, iv)
  let encrypted = cipher.update(token, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const ivstring = iv.toString('base64')
  return `${encrypted}:${ivstring}`
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+/g, '')
}

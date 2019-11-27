// @flow
import type { UserRecord } from '../../imports/types'
import jwt from 'jsonwebtoken'
import conf from '../server.config'
import crypto from 'crypto'

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

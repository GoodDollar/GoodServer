// @flow
import { generateMarketToken } from '../storageAPI'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import conf from '../../server.config'
test('should generate marketToken', () => {
  const encrypted = generateMarketToken({ email: 'h@gd.org', fullName: 'h r' })
  const base64 = encrypted.replace(/\-/g, '+').replace(/\_/g, '/')
  const cipher = crypto.createDecipher('aes-256-cbc', conf.marketPassword)
  let decrypted = cipher.update(base64, 'base64', 'utf8')
  decrypted += cipher.final('utf8')
  let data = jwt.verify(decrypted, conf.marketPassword)
  expect(data).toMatchObject({ email: 'h@gd.org', name: 'h r' })
})

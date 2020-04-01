// @flow
import { generateMarketToken } from '../../utils/market'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import conf from '../../server.config'
test('should generate marketToken', () => {
  const pass = conf.marketPassword
  const encrypted = generateMarketToken({ email: 'h@gd.org', fullName: 'h r' })
  const base64 = encrypted.replace(/-/g, '+').replace(/_/g, '/')
  const parts = base64.split(':')
  const cipher = crypto.createDecipheriv('aes-256-cbc', pass, Buffer.from(parts[1], 'base64'))
  let decrypted = cipher.update(parts[0], 'base64', 'utf8')
  decrypted += cipher.final('utf8')
  let data = jwt.verify(decrypted, pass)
  expect(data).toMatchObject({ email: 'h@gd.org', name: 'h r' })
})

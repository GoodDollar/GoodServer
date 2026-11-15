import { getClientIp } from '../clientIp'

describe('getClientIp', () => {
  test('uses req.ip and ignores the X-Forwarded-For header', () => {
    const req = { ip: '203.0.113.7', headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }

    expect(getClientIp(req)).toBe('203.0.113.7')
  })

  test('normalises IPv4-mapped IPv6 addresses', () => {
    expect(getClientIp({ ip: '::ffff:198.51.100.2' })).toBe('198.51.100.2')
  })

  test('keeps real IPv6 addresses', () => {
    expect(getClientIp({ ip: '2001:db8::1' })).toBe('2001:db8::1')
  })

  test('returns an empty string when the ip is missing', () => {
    expect(getClientIp({})).toBe('')
  })
})

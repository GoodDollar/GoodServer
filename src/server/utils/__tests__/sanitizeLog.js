import { sanitizeLog } from '../sanitizeLog'

describe('sanitizeLog', () => {
  test('replaces line breaks so values cannot forge log entries', () => {
    expect(sanitizeLog('abc\nINFO fake entry\r\nmore')).toBe('abc INFO fake entry more')
  })

  test('leaves other values untouched', () => {
    expect(sanitizeLog('plain')).toBe('plain')
    expect(sanitizeLog(5)).toBe(5)
    expect(sanitizeLog(undefined)).toBeUndefined()
  })
})

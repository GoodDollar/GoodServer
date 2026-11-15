// @flow
import type { $Request } from 'express'

const IPV4_MAPPED_PREFIX = /^::ffff:/i

/**
 * Returns the client IP as validated by Express (`req.ip`).
 *
 * Unlike reading the leftmost `X-Forwarded-For` entry, `req.ip` only trusts the number of proxy hops configured with
 * `app.set('trust proxy', n)`, so a caller cannot choose its own address by sending that header.
 * IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are normalised to plain IPv4.
 */
export const getClientIp = (req: $Request): string => String(req.ip || '').replace(IPV4_MAPPED_PREFIX, '')

export default getClientIp

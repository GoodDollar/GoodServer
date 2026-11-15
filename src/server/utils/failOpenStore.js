// @flow

/**
 * Wraps an express-rate-limit store so that a failing backend (e.g. redis outage) never fails the request:
 * if the store throws, the request is let through (fail open) and the error is logged.
 * Without this, a store error propagates to the route and, for login routes, blocks authentication.
 */
export default class FailOpenStore {
  store: any
  logger: any
  windowMs: number = 60 * 1000

  constructor(store: any, logger: any) {
    this.store = store
    this.logger = logger

    // some stores expose these and express-rate-limit reads them
    this.localKeys = store.localKeys
    this.prefix = store.prefix
  }

  init(options: any) {
    if (options && options.windowMs) {
      this.windowMs = options.windowMs
    }

    return this.store.init && this.store.init(options)
  }

  async increment(key: string) {
    try {
      return await this.store.increment(key)
    } catch (e) {
      this.logger.error('rate limit store failed, allowing request', e.message, e, { key })

      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) }
    }
  }

  async decrement(key: string) {
    return this._safely('decrement', key)
  }

  async resetKey(key: string) {
    return this._safely('resetKey', key)
  }

  async _safely(method: string, key: string) {
    try {
      return await this.store[method](key)
    } catch (e) {
      this.logger.error(`rate limit store ${method} failed`, e.message, e, { key })
    }
  }
}

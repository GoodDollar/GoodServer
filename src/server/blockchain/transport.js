// @flow

import Web3 from 'web3'
import { assign, isError, isString, has, shuffle } from 'lodash'
import { fallback, makePromiseWrapper, retry } from '../utils/async'
import logger from '../../imports/logger'
import conf from '../server.config'

const { providers } = Web3
const { HttpProvider } = providers
const log = logger.child({ from: 'MultipleHttpProvider' })

const isTxError = message => String(message)?.search(/hash|nonce|already\s*known|fee|underpriced|reverted|gas/i) >= 0

const connectionErrorRegex = /((connection|network) (error|timeout)|invalid json rpc)/i
const rateLimitErrorRegex = /too many|quota|limit/i

export const isConnectionError = error => {
  const isException = isError(error)

  if (!isException && !isString(error)) {
    return false
  }

  return connectionErrorRegex.test(isException ? error.message : error || '')
}

export const isRateLimitError = reasonThrown => {
  const isException = isError(reasonThrown)

  if (!isException && !isString(reasonThrown) && !('error' in reasonThrown)) {
    return false
  }

  return rateLimitErrorRegex.test(isException ? reasonThrown.message : reasonThrown.error?.message ?? reasonThrown)
}

export class MultipleHttpProvider extends HttpProvider {
  constructor(endpoints, config) {
    const [{ provider, options }] = endpoints // init with first endpoint config
    const { strategy = 'random', retries = 2 } = config || {} // or 'random'

    log.debug('Setting default endpoint', { provider, config })
    super(provider, options)

    log.debug('Initialized', { endpoints, strategy })

    assign(this, {
      endpoints,
      strategy,
      retries
    })
  }

  send(payload, callback) {
    const { endpoints, strategy, retries } = this

    // shuffle peers if random strategy chosen
    const peers = strategy === 'random' ? shuffle(endpoints) : endpoints

    // eslint-disable-next-line require-await
    const calls = peers.map(item => async () => {
      const { provider, options } = item

      log.trace('Picked up peer', { provider, options }, payload.id)

      // calling ctor as fn with this context, to re-apply ALL settings
      // as ctor is defined as function, not as class this hack will work
      // see node_modules/web3-providers-http/src/index.js
      HttpProvider.call(this, provider, options)

      try {
        log.trace('Sending request to peer', { payload })
        return await this._sendRequest(payload)
      } catch (exception) {
        // log error to analytics if last peer failed, ie all rpcs failed
        const error = exception?.error ? JSON.stringify(exception?.error) : exception.message
        const notTxError = !isTxError(error)
        if (notTxError && peers[peers.length - 1] === item) {
          const errorMessage = 'Failed all RPCs' // so in analytics all errors are grouped under same message

          // log.exception bypass network error filtering
          log.error('MultiHttpProvider:', errorMessage, exception, { error, provider, payload })
        } else if (isRateLimitError(exception)) {
          log.warn('MultiHttpProvider rate limit error', exception.message, exception, { error, provider })
          endpoints.splice(endpoints.indexOf(item, 1))
          setTimeout(() => endpoints.push(item), 60000)
        } else if (notTxError) {
          log.warn('MultiHttpProvider failed to send:', error, exception, { provider })
        }

        throw exception
      }
    })

    const onSuccess = result => {
      log.trace('Success, got result', { result })
      callback(null, result)
    }

    const onFailed = error => {
      log.warn('Failed RPC call', error.message, error, payload.id)

      callback(error, null)
    }

    // if not connection issue - stop fallback, throw error
    const onFallback = exception => {
      const { message, error, code } = exception
      const errorMessage = exception?.error ? JSON.stringify(exception?.error) : exception.message
      const txError = isTxError(errorMessage)
      const conError = isConnectionError(error)

      // retry if not tx issue and network error or if rpc responded with error (error.error)
      const willFallback = !txError && !!(code || error || !message || conError)

      if (!willFallback) {
        log.warn('send: got error without fallback', { message, error, willFallback, txError, conError, exception })
      }

      return willFallback
    }

    log.trace('send: exec over peers', { peers, strategy, calls })

    retry(() => fallback(calls, onFallback), retries, 0)
      .then(onSuccess)
      .catch(onFailed)
  }

  /**
   * Promisifies HttpProvider.send to be compatible with fallback() util
   * @private
   * */
  // eslint-disable-next-line require-await
  async _sendRequest(payload) {
    const { promise, callback: pcallback } = makePromiseWrapper()

    const checkRpcError = (error, response) => {
      //regular network error
      if (error) {
        return pcallback(error)
      }

      //rpc responded with error or no result
      if (response.error || has(response, 'result') === false) {
        return pcallback(response)
      }

      //response ok
      return pcallback(null, response)
    }

    super.send(payload, checkRpcError)
    return promise
  }
}

export class HttpProviderFactory {
  static create(rpcsList, config = {}) {
    const endpoints = rpcsList.split(',').map(provider => {
      const headers = HttpProviderFactory.getAuthHeader(provider)
      const options = { ...config, headers }

      return { provider, options }
    })

    return new MultipleHttpProvider(endpoints, { strategy: conf.httpProviderStrategy })
  }

  /**
   * @private
   */
  static getAuthHeader(rpc) {
    const url = new URL(rpc)

    if (!url.password) {
      return []
    }

    return [
      {
        name: 'Authorization',
        value: `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}`
      }
    ]
  }
}

export const { WebsocketProvider } = providers

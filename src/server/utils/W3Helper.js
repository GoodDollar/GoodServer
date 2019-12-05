import fetch from 'cross-fetch'
import md5 from 'md5'
import conf from '../server.config'
import logger from '../../imports/pino-logger'

const log = logger.child({ from: 'W3Helper' })
const Timeout = timeout => {
  return new Promise((res, rej) => {
    setTimeout(rej, timeout, new Error('Request Timeout'))
  })
}

export default {
  baseUrl: `${conf.web3SiteUrl}/api/wl/user`,
  baseHeaders: {
    'Content-Type': 'application/json'
  },

  baseQuery(url, headers, body, method = 'post', options = {}, timeout = 15000) {
    const fullUrl = `${this.baseUrl}${url}`
    const stringBody = method !== 'GET' ? JSON.stringify(body) : undefined

    log.debug('req options', { url, headers, body, method, options, timeout })

    return Promise.race([Timeout(timeout), fetch(fullUrl, { method, body: stringBody, headers })])
      .then(async res => {
        log.debug('request response', res)

        if (res.status >= 300) {
          throw new Error(await res.text())
        }

        return res.json()
      })
      .then(response => {
        let toReturn = response.data

        if (options.getResponse) {
          toReturn = response
        }

        return toReturn
      })
      .catch(e => {
        log.error('Failed to execute the request to W3 API', e.message, e)

        throw e
      })
  },

  w3PUTUserReq(user, _options) {
    const options = {
      getResponse: false,
      ..._options
    }
    const secureHash = md5(user.email + conf.secure_key)

    log.debug('secureHash', { user, secureHash })

    return this.baseQuery(
      '',
      this.baseHeaders,
      {
        secure_hash: secureHash.toLowerCase(),
        ...user
      },
      'PUT',
      options
    ).catch(() => ({}))
  },

  registerUser(user, options) {
    return this.w3PUTUserReq(
      {
        email: user.email,
        full_name: user.fullName,
        wallet_address: user.gdAddress
      },
      options
    )
  },

  getLoginOrWalletToken(user, options) {
    return this.w3PUTUserReq({ email: user.email }, options)
  },

  informW3ThatBonusCharged(bonusAmount, walletToken) {
    return this.baseQuery(
      '/redeem',
      {
        ...this.baseHeaders,
        Authorization: walletToken
      },
      {
        redeemed_bonus: bonusAmount
      },
      'PUT'
    )
  },

  getUser(walletToken, _options) {
    const options = {
      getResponse: false,
      ..._options
    }

    return this.baseQuery(
      '',
      {
        Authorization: walletToken
      },
      {},
      'GET',
      options
    )
  }
}

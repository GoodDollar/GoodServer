import fetch from 'cross-fetch'
import md5 from 'md5'
import conf from '../server.config'
import logger from '../../imports/pino-logger'

const log = logger.child({ from: 'W3Helper' })

export default {
  baseUrl: `${conf.web3SiteUrl}/api/wl/user`,
  baseHeaders: {
    'Content-Type': 'application/json'
  },

  w3PUTUserReq(user, _options) {
    const options = {
      getResponse: false,
      ..._options
    }
    const secureHash = md5(user.email + conf.secure_key)

    log.debug('secureHash', { user, secureHash })

    return new Promise((resolve, reject) => {
      fetch(this.baseUrl, {
        method: 'PUT',
        headers: this.baseHeaders,
        body: JSON.stringify({
          secure_hash: secureHash.toLowerCase(),
          ...user
        })
      })
        .then(r => r.json())
        .then(response => {
          let toReturn = response.data

          log.debug('w3PUTUserReq response', response)

          if (options.getResponse) {
            toReturn = response
          }

          resolve(toReturn)
        })
        .catch(e => {
          log.error('Fetch W3 User Failed', e.message, e)

          reject(e)
        })
    })
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
    fetch(`${this.baseUrl}/redeem`, {
      method: 'PUT',
      headers: {
        ...this.baseUrl,
        Authorization: walletToken
      },
      body: JSON.stringify({
        redeemed_bonus: bonusAmount
      })
    }).catch(e => {
      log.error('Failed to update W3 with redeemed bonus', e.message, e)
    })
  },

  getUser(walletToken, options) {
    options = options || {
      getResponse: false
    }

    return new Promise((resolve, reject) => {
      fetch(this.baseUrl, {
        method: 'GET',
        headers: {
          Authorization: walletToken
        }
      })
        .then(res => res.json())
        .then(response => {
          let toReturn = response.data

          log.debug('getUser response', response)

          if (options.getResponse) {
            toReturn = response
          }

          resolve(toReturn)
        })
        .catch(e => {
          log.error('Failed to fetch W3 user from W3 api', e.message, e)

          reject(e)
        })
    })
  }
}

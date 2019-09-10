import fetch from 'cross-fetch'
import md5 from 'md5'
import conf from '../server.config'
import logger from '../../imports/pino-logger'

const log = logger.child({ from: 'W3Helper' })

const w3PUTUserReq = (user, options) => {
  options = options || {
    getResponse: false
  }

  const secureHash = md5(user.email + conf.secure_key)
  const url = `${conf.web3SiteUrl}/api/wl/user`

  return new Promise((resolve, reject) => {
    fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secure_hash: secureHash.toLowerCase(),
        ...user
      })
    })
      .then(r => r.json())
      .then(response => {
        let toReturn = response.data

        if (options.getResponse) {
          toReturn = response
        }

        resolve(toReturn)
      })
      .catch(e => {
        log.error('Register W3 User Failed', e.message, e)

        reject(e)
      })
  })
}

export const registerUser = (user, options) => {
  return w3PUTUserReq(
    {
      email: user.email,
      full_name: user.fullName,
      wallet_address: user.gdAddress
    },
    options
  )
}

export const getLoginOrWalletToken = (user, options) => {
  return w3PUTUserReq({ email: user.email }, options)
}

export const informW3ThatBonusCharged = (bonusAmount, walletToken) => {
  const url = `${conf.web3SiteUrl}/api/wl/user/redeem`

  fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: walletToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redeemed_bonus: bonusAmount
    })
  }).catch(e => {
    log.error('Failed to update W3 with redeemed bonus', e.message, e)
  })
}

export const getUser = (walletToken, options) => {
  options = options || {
    getResponse: false
  }

  const url = `${conf.web3SiteUrl}/api/wl/user`

  return new Promise((resolve, reject) => {
    fetch(url, {
      method: 'GET',
      headers: {
        Authorization: walletToken
      }
    })
      .then(res => res.json())
      .then(response => {
        let toReturn = response.data

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

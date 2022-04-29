import { assign, isEmpty, bindAll, isError, defaults } from 'lodash'

import Config from '../../server/server.config'

import TorusVerifier from '../../imports/torusVerifier'
import FacebookVerifier from '../../imports/facebookVerifier'
import { retry, withTimeout } from '../utils/async'

class DefaultVerificationStrategy {
  constructor(config) {
    const { torusVerificationRetryDelay, torusVerificationAttempts, torusVerificationTimeout } = config

    bindAll(this, '_callVerifier')

    assign(this, {
      torusVerificationRetryDelay,
      torusVerificationAttempts,
      torusVerificationTimeout
    })
  }

  async verify(requestPayload, userRecord, logger) {
    const { torusProof } = requestPayload
    let verificationResult = { emailVerified: false, mobileVerified: false }

    const {
      _callVerifier,
      _onRetry,
      torusVerificationTimeout,
      torusVerificationRetryDelay,
      torusVerificationAttempts
    } = this

    if (!torusProof) {
      logger.warn('TorusVerifier skipping because no torusProof was specified')
      return
    }

    try {
      // calling TorusProvider
      verificationResult = await retry(
        async () => withTimeout(_callVerifier(requestPayload), torusVerificationTimeout),
        torusVerificationAttempts,
        torusVerificationRetryDelay,
        _onRetry
      )
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('TorusVerifier failed:', { e: exception, msg })
    }

    logger.info('TorusVerifier result:', verificationResult)
    return verificationResult
  }

  // eslint-disable-next-line require-await
  async _callVerifier(requestPayload) {
    const { torusProof, torusProvider, torusProofNonce } = requestPayload
    const verifier = TorusVerifier.factory(this.logger)

    return verifier.verifyProof(torusProof, torusProvider, requestPayload, torusProofNonce)
  }

  _onRetry(reason) {
    const { message } = reason || {}

    // checking if the reason related to the some nodes are down
    return isError(reason) && message.toLowerCase().includes('node results do not match')
  }
}

class FacebookVerificationStrategy {
  async verify(requestPayload, userRecord, logger) {
    let emailVerified = false
    const { isEmailConfirmed = false } = userRecord || {}
    const { email, torusAccessToken } = requestPayload

    if (!torusAccessToken) {
      logger.warn('FacebookVerifier skipping because no accessToken was specified')
      return
    }

    if (isEmailConfirmed) {
      logger.warn('FacebookVerifier skipping because email already verified')
      emailVerified = true
    } else {
      try {
        emailVerified = await FacebookVerifier.verifyEmail(email, torusAccessToken, logger)
      } catch (exception) {
        const { message: msg } = exception

        logger.warn('FacebookVerifier failed:', { e: exception, msg })
      }

      logger.info('FacebookVerifier result:', { emailVerified })
    }

    return { emailVerified, mobileVerified: false }
  }
}

class UserVerifier {
  static strategies = {}

  static get hasStrategiesAttached() {
    return !isEmpty(UserVerifier.strategies)
  }

  // initialization incapsulated via factory pattern
  static factory(userRecord, requestPayload, logger) {
    const { hasStrategiesAttached, addStrategy } = UserVerifier

    // attaching strategies on first call
    if (!hasStrategiesAttached) {
      addStrategy('default', new DefaultVerificationStrategy(Config))
      addStrategy('facebook', new FacebookVerificationStrategy())
    }

    return new UserVerifier(userRecord, requestPayload, logger)
  }

  static addStrategy(provider, strategy) {
    UserVerifier.strategies[provider] = strategy
  }

  constructor(userRecord, requestPayload, logger) {
    assign(this, { userRecord, requestPayload, logger })
  }

  async verifySignInIdentifiers() {
    const { strategies } = UserVerifier
    const { userRecord, requestPayload, logger } = this
    const { torusProvider } = requestPayload
    const strategy = strategies[torusProvider] || strategies.default
    const result = await strategy.verify(requestPayload, userRecord, logger)

    return defaults(result || {}, { emailVerified: false, mobileVerified: false })
  }
}

export default UserVerifier.factory

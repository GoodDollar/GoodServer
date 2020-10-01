import { assign, isEmpty, bindAll, isError } from 'lodash'

import Config from '../../server/server.config'

import TorusVerifier from '../../imports/torusVerifier'
import FacebookVerifier from '../../imports/facebookVerifier'

import { retry } from '../utils/async'

class DefaultVerificationStrategy {
  constructor(config) {
    const { torusVerificationRetryDelay, torusVerificationAttempts } = config

    bindAll(this, '_onRetry', '_callVerifier')
    assign(this, { torusVerificationRetryDelay, torusVerificationAttempts })
  }

  async verify(requestPayload, userRecord, logger) {
    const { torusProof, torusProvider, torusProofNonce } = requestPayload
    const { torusVerificationRetryDelay, torusVerificationAttempts } = this
    let verificationResult = { emailVerified: false, mobileVerified: false }

    if (!torusProof) {
      logger.warn('TorusVerifier skipping because no torusProof was specified')
      return
    }

    try {
      // eslint-disable-next-line
      verificationResult = await retry(
        () => TorusVerifier.verifyProof(torusProof, torusProvider, requestPayload, torusProofNonce),
        torusVerificationAttempts,
        torusVerificationRetryDelay,
        reason => {
          const { message } = reason || {}

          // checking if the reason related to the some nodes are down
          return isError(reason) && message.toLowerCase().includes('node results do not match')
        }
      )
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('TorusVerifier failed:', { e: exception, msg })
    }

    const { emailVerified, mobileVerified } = verificationResult

    logger.info('TorusVerifier result:', verificationResult)
    userRecord.smsValidated = userRecord.smsValidated || mobileVerified
    userRecord.isEmailConfirmed = userRecord.isEmailConfirmed || emailVerified
  }
}

class FacebookVerificationStrategy {
  async verify(requestPayload, userRecord, logger) {
    let emailVerified = false
    const { email, torusAccessToken } = requestPayload

    if (userRecord.isEmailConfirmed) {
      logger.warn('FacebookVerifier skipping because email already verified')
      return
    }

    if (!torusAccessToken) {
      logger.warn('FacebookVerifier skipping because no accessToken was specified')
      return
    }

    try {
      emailVerified = await FacebookVerifier.verifyEmail(email, torusAccessToken, logger)
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('FacebookVerifier failed:', { e: exception, msg })
    }

    logger.info('FacebookVerifier result:', { emailVerified })
    userRecord.isEmailConfirmed = userRecord.isEmailConfirmed || emailVerified
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

    await strategy.verify(requestPayload, userRecord, logger)
  }
}

export default UserVerifier.factory

import { assign, isEmpty, bindAll, isError } from 'lodash'
import { from as fromPromise, defer, throwError, timer } from 'rxjs'
import { mergeMap, retryWhen } from 'rxjs/operators'

import Config from '../../server/server.config'

import TorusVerifier from '../../imports/torusVerifier'
import FacebookVerifier from '../../imports/facebookVerifier'

class DefaultVerificationStrategy {
  constructor(config) {
    const { torusVerificationRetryDelay, torusVerificationAttempts } = config

    bindAll(this, '_onRetry', '_callVerifier')
    assign(this, { torusVerificationRetryDelay, torusVerificationAttempts })
  }

  async verify(requestPayload, userRecord, logger) {
    const { torusProof } = requestPayload
    const { _callVerifier, _onRetry } = this
    let verificationResult = { emailVerified: false, mobileVerified: false }

    if (!torusProof) {
      logger.warn('TorusVerifier skipping because no torusProof was specified')
      return
    }

    try {
      verificationResult = await defer(() => fromPromise(_callVerifier(requestPayload))) // calling TorusProvider
        .pipe(retryWhen(attempts => attempts.pipe(mergeMap(_onRetry)))) // on each failure passing rejection reason
        .toPromise() // through the onRetry callback to determine should we retry or not and how long we have to wait before
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('TorusVerifier failed:', { e: exception, msg })
    }

    const { emailVerified, mobileVerified } = verificationResult

    logger.info('TorusVerifier result:', verificationResult)
    userRecord.smsValidated = userRecord.smsValidated || mobileVerified
    userRecord.isEmailConfirmed = userRecord.isEmailConfirmed || emailVerified
  }

  // eslint-disable-next-line require-await
  async _callVerifier(requestPayload) {
    const { torusProof, torusProvider, torusProofNonce } = requestPayload

    return TorusVerifier.verifyProof(torusProof, torusProvider, requestPayload, torusProofNonce)
  }

  _onRetry(reason, attemptIndex) {
    const { message } = reason || {}
    const { torusVerificationRetryDelay, torusVerificationAttempts } = this

    // checking if the reason related to the some nodes are down
    if (isError(reason) && message.toLowerCase().includes('node results do not match')) {
      const retryAttempt = attemptIndex + 1

      // if yes - checking attempts count
      if (retryAttempt <= torusVerificationAttempts) {
        // if we aren't reached it yet - retrying call
        return timer(torusVerificationRetryDelay)
      }
    }

    // if the reason not related to the temporary unavailability of the Torus services
    // or we've reached the verification attempts limit - just re-throwing the reason
    return throwError(reason)
  }
}

class FacebookVerificationStrategy {
  async verify(requestPayload, userRecord, logger) {
    let emailVerified = false
    const { email, torusAccessToken } = requestPayload

    if (!torusAccessToken) {
      logger.warn('FacebookVerifier skipping because no accessToken was specified')
      return
    }

    try {
      emailVerified = await FacebookVerifier.verifyEmail(email, torusAccessToken)
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
    const { hasStrategiesAttached, addStrategy } = this

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

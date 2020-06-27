import { assign } from 'lodash'

import TorusVerifier from '../../imports/torusVerifier'
import FacebookVerifier from '../../imports/facebookVerifier'

class DefaultVerificationStrategy {
  async verify(requestPayload, userRecord, logger) {
    const { torusProof, torusProvider, torusProofNonce } = requestPayload
    let verificationResult = { emailVerified: false, mobileVerified: false }

    if (!torusProof) {
      logger.warn('TorusVerifier skipping because no torusProof was specified')
      return
    }

    try {
      verificationResult = await TorusVerifier.verifyProof(torusProof, torusProvider, requestPayload, torusProofNonce)
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('TorusVerifier failed:', { e: exception, msg })
    }

    const { emailVerified, mobileVerified } = verificationResult

    logger.info('TorusVerifier result:', verificationResult)
    userRecord.smsValidated |= mobileVerified
    userRecord.isEmailConfirmed |= emailVerified
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
    userRecord.isEmailConfirmed |= emailVerified
  }
}

class UserVerifier {
  static strategies = {
    default: new DefaultVerificationStrategy()
  }

  static addStrategy(provider, strategyClass) {
    UserVerifier.strategies[provider] = new strategyClass()
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

UserVerifier.addStrategy('facebook', FacebookVerificationStrategy)

export default (userRecord, requestPayload, logger) => new UserVerifier(userRecord, requestPayload, logger)

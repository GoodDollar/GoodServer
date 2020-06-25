import { assign } from 'lodash'

import TorusVerifier from '../../imports/torusVerifier'
import FacebookVerifier from '../../imports/facebookVerifier'

class UserVerifier {
  constructor(userRecord, requestPayload, logger) {
    assign(this, { userRecord, requestPayload, logger })
  }

  async verifyEmail(email, torusAccessToken) {
    let emailVerified = false
    const { userRecord, logger } = this

    try {
      emailVerified = await FacebookVerifier.verifyEmail(email, torusAccessToken)
    } catch (exception) {
      const { message: msg } = exception

      logger.warn('FacebookVerifier failed:', { e: exception, msg })
    }

    logger.info('FacebookVerifier result:', { emailVerified })
    userRecord.isEmailConfirmed |= emailVerified
  }

  async verifyProof(torusProof, torusProvider, torusProofNonce) {
    const { userRecord, requestPayload, logger } = this
    let verificationResult = { emailVerified: false, mobileVerified: false }

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

export default (userRecord, requestPayload, logger) => new UserVerifier((userRecord, requestPayload, logger))

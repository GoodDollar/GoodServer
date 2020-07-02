import FetchNodeDetails from '@toruslabs/fetch-node-details/dist/fetchNodeDetails-node.js'
import TorusUtils from '@toruslabs/torus.js/dist/torusUtils-node.js'
import moment from 'moment'
import Config from '../server/server.config'
import { recoverPublickey } from '../server/utils/eth'
import logger from '../imports/logger'

class GoogleLegacyStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: 'google-gooddollar',
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class GoogleStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: 'google-auth0-gooddollar',
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class PasswordlessEmailStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: 'google-auth0-gooddollar',
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class PasswordlessSMSStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: 'gooddollar-auth0-sms-passwordless',
      identifier: userRecord.mobile,
      emailVerified: false,
      mobileVerified: true
    }
  }
}

class TorusVerifier {
  strategies = {}

  static factory() {
    const verifier = new TorusVerifier(Config, logger.child({ from: 'TorusVerifier' }))

    verifier.addStrategy('google', GoogleStrategy)
    verifier.addStrategy('google-old', GoogleLegacyStrategy)
    verifier.addStrategy('auth0-pwdless-sms', PasswordlessSMSStrategy)
    verifier.addStrategy('auth0-pwdless-email', PasswordlessEmailStrategy)

    return verifier
  }

  constructor(Config, logger) {
    const { torusNetwork, torusProxyContract } = Config

    this.torus = new TorusUtils()
    this.logger = logger

    this.fetchNodeDetails = new FetchNodeDetails({
      torusNetwork,
      proxyAddress: torusProxyContract
    })
  }

  async isIdentifierOwner(publicAddress, verifier, identifier) {
    const { torus, logger } = this
    const { torusNodeEndpoints, torusNodePub } = await this.fetchNodeDetails.getNodeDetails()

    const response = await torus.getPublicAddress(
      torusNodeEndpoints,
      torusNodePub,
      { verifier, verifierId: identifier },
      false
    )

    logger.debug('isIdentifierOwner:', { identifier, response })
    return publicAddress.toLowerCase() === response.toLowerCase()
  }

  getVerificationOptions(torusType, userRecord) {
    const { strategies } = this

    if (!torusType || !(torusType in strategies)) {
      throw new Error('unknown torus login type: ' + torusType)
    }

    return strategies[torusType].getVerificationOptions(userRecord)
  }

  async verifyProof(signature, torusType, userRecord, nonce) {
    const { logger } = this

    if (moment().diff(moment(Number(nonce)), 'minutes') >= 1) {
      throw new Error('torus proof nonce invalid:' + nonce)
    }

    const { verifier, identifier, emailVerified, mobileVerified } = this.getVerificationOptions(torusType, userRecord)

    logger.debug('verifyProof', { signature, identifier, verifier, torusType, userRecord, nonce })

    const signedPublicKey = recoverPublickey(signature, identifier, nonce)
    const isOwner = await this.isIdentifierOwner(signedPublicKey, verifier, identifier)

    logger.info('verifyProof result:', { isOwner, signedPublicKey })

    if (isOwner) {
      return { emailVerified, mobileVerified }
    }

    return { emailVerified: false, mobileVerified: false }
  }

  addStrategy(torusType, strategyClass) {
    this.strategies[torusType] = new strategyClass()
  }
}

export default TorusVerifier.factory()

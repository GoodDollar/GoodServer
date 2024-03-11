import FetchNodeDetails from '@toruslabs/fetch-node-details'
import TorusUtils from '@toruslabs/torus.js/dist/torusUtils-node.js'
import moment from 'moment'
import { get } from 'lodash'

import Config from '../server/server.config'
import { recoverPublickey } from '../server/utils/eth'
import logger from '../imports/logger'

class GoogleLegacyStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: Config.torusGoogle,
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class GoogleStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: Config.torusGoogleAuth0,
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class PasswordlessEmailStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: Config.torusGoogleAuth0,
      identifier: userRecord.email,
      emailVerified: true,
      mobileVerified: false
    }
  }
}

class PasswordlessSMSStrategy {
  getVerificationOptions(userRecord) {
    return {
      verifier: Config.torusAuth0SMS,
      identifier: userRecord.mobile,
      emailVerified: false,
      mobileVerified: true
    }
  }
}

class TorusVerifier {
  strategies = {}

  static factory(log = logger.child({ from: 'TorusVerifier' })) {
    const { torusNetwork, torusClientId } = Config
    const torus = new TorusUtils({
      network: torusNetwork !== 'mainnet' ? 'testnet' : 'mainnet',
      clientId: torusClientId
    })

    const fetchNodeDetails = new FetchNodeDetails({
      network: torusNetwork !== 'mainnet' ? 'testnet' : 'mainnet'
    })

    // incapsulating verifier initialization using factory pattern
    const verifier = new TorusVerifier(torus, fetchNodeDetails, log)

    // Strategy pattern defines that strategies should be passed from outside
    // The main class shouldn't pass them to itself (expect probably some default/fallback strategy)
    verifier.addStrategy('google', GoogleStrategy)
    verifier.addStrategy('google-old', GoogleLegacyStrategy)
    verifier.addStrategy('auth0-pwdless-sms', PasswordlessSMSStrategy)
    verifier.addStrategy('auth0-pwdless-email', PasswordlessEmailStrategy)

    return verifier
  }

  constructor(torus, fetchNodeDetails, logger) {
    this.torus = torus
    this.fetchNodeDetails = fetchNodeDetails
    this.logger = logger
  }

  async isIdentifierOwner(publicAddress, verifier, identifier) {
    try {
      const { torus, logger, fetchNodeDetails } = this
      const { torusNodeEndpoints, torusNodePub } = await fetchNodeDetails.getNodeDetails({
        verifier,
        verifierId: identifier
      })

      const response = await torus.getPublicAddress(
        torusNodeEndpoints,
        torusNodePub,
        { verifier, verifierId: identifier },
        false
      )

      const responseAddr = get(response, 'finalKeyData.evmAddress', '')
      logger.debug('isIdentifierOwner:', { identifier, response, publicAddress, responseAddr })
      return publicAddress.toLowerCase() === responseAddr.toLowerCase()
    } catch (e) {
      logger.error('isIdentifierOwner failed:', e.message, e, { verifier, identifier, publicAddress })
      throw e
    }
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

    if (moment().diff(moment(Number(nonce)), 'minutes') > 4) {
      throw new Error('torus proof nonce invalid:' + nonce)
    }

    const { verifier, identifier, emailVerified, mobileVerified } = this.getVerificationOptions(torusType, userRecord)

    logger.debug('verifyProof', { signature, identifier, verifier, torusType, userRecord, nonce })

    const signedPublicKey = recoverPublickey(signature, identifier, nonce)
    const isOwner = await this.isIdentifierOwner(signedPublicKey, verifier, identifier)

    if (isOwner) {
      logger.info('verifyProof result:', { isOwner, signedPublicKey })

      return { emailVerified, mobileVerified }
    } else {
      logger.warn('verifyProof result failed:', { isOwner, signedPublicKey, verifier, identifier })
    }

    return { emailVerified: false, mobileVerified: false }
  }

  addStrategy(torusType, strategyClass) {
    this.strategies[torusType] = new strategyClass()
  }
}

export default TorusVerifier

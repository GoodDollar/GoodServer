import FetchNodeDetails from '@toruslabs/fetch-node-details/dist/fetchNodeDetails-node.js'
import TorusUtils from '@toruslabs/torus.js/dist/torusUtils-node.js'
import moment from 'moment'
import Config from '../server/server.config'
import { recoverPublickey } from '../server/utils/eth'

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
      verifier: 'google-auth0-gooddollar',
      identifier: userRecord.mobile,
      emailVerified: false,
      mobileVerified: true
    }
  }
}

class TorusVerifier {
  strategies = {}

  constructor(proxyContract = null, network = null) {
    this.torus = new TorusUtils()

    this.fetchNodeDetails = new FetchNodeDetails({
      network,
      proxyAddress: proxyContract
    })
  }

  async isIdentifierOwner(publicAddress, verifier, identifier) {
    const { torusNodeEndpoints, torusNodePub } = await this.fetchNodeDetails.getNodeDetails()
    const response = await this.torus.getPublicAddress(
      torusNodeEndpoints,
      torusNodePub,
      { verifier, verifierId: identifier },
      false
    )

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
    if (moment().diff(moment(nonce), 'minutes') >= 1) {
      throw new Error('torus proof nonce invalid:' + nonce)
    }

    const { verifier, identifier, emailVerified, mobileVerified } = this.getVerificationOptions(torusType, userRecord)
    const signedPublicKey = recoverPublickey(signature, identifier, nonce)
    const isOwner = await this.isIdentifierOwner(signedPublicKey, verifier, identifier)

    if (isOwner) {
      return { emailVerified, mobileVerified }
    }

    return { emailVerified: false, mobileVerified: false }
  }

  addStrategy(torusType, strategyClass) {
    this.strategies[torusType] = new strategyClass()
  }
}

const verifierConfig = Config.env === 'production' ? [] : ['0x4023d2a0D330bF11426B12C6144Cfb96B7fa6183', 'ropsten'] // [contract, network]
const verifier = Reflect.construct(TorusVerifier, verifierConfig)

verifier.addStrategy('google', GoogleStrategy)
verifier.addStrategy('google-old', GoogleLegacyStrategy)
verifier.addStrategy('auth0-pwdless-sms', PasswordlessSMSStrategy)
verifier.addStrategy('auth0-pwdless-email', PasswordlessEmailStrategy)

export default verifier

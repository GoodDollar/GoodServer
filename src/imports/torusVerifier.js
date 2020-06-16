import FetchNodeDetails from '@toruslabs/fetch-node-details/dist/fetchNodeDetails-node.js'
import TorusUtils from '@toruslabs/torus.js/dist/torusUtils-node.js'
import Config from '../server/server.config'
import { recoverPublickey } from '../server/utils/eth'
class TorusVerifier {
  constructor(proxyContract, network) {
    this.fetchNodeDetails = new FetchNodeDetails({ network, proxyAddress: proxyContract })
    this.torus = new TorusUtils()
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

  getVerifierAndIdentifier(torusType, userRecord) {
    switch (torusType) {
      case 'google-old':
        return {
          verifier: 'google-gooddollar',
          identifier: userRecord.email,
          emailVerified: true,
          mobileVerified: false
        }
      case 'google':
        return {
          verifier: 'google-auth0-gooddollar',
          identifier: userRecord.email,
          emailVerified: true,
          mobileVerified: false
        }
      case 'facebook':
        return {
          verifier: 'facebook-gooddollar',
          identifier: userRecord.email,
          emailVerified: true,
          mobileVerified: false
        }
      case 'auth0-pwdless-email':
        return {
          verifier: 'google-auth0-gooddollar',
          identifier: userRecord.email,
          emailVerified: true,
          mobileVerified: false
        }
      case 'auth0-pwdless-sms':
        return {
          verifier: 'google-auth0-gooddollar',
          identifier: userRecord.mobile,
          emailVerified: false,
          mobileVerified: true
        }
      default:
        throw new Error('unknown torus login type: ' + torusType)
    }
  }
  async verifyProof(signature, torusType, userRecord, nonce) {
    if (Date.now() - nonce > 60000) {
      throw new Error('torus proof nonce invalid:' + nonce)
    }
    const { verifier, identifier, emailVerified, mobileVerified } = this.getVerifierAndIdentifier(torusType, userRecord)
    const signedPublicKey = recoverPublickey(signature, identifier, nonce)
    const isOwner = await this.isIdentifierOwner(signedPublicKey, verifier, identifier)
    if (isOwner) {
      return { emailVerified, mobileVerified }
    }
    return { emailVerified: false, mobileVerified: false }
  }
}

const verifier =
  Config.env === 'production'
    ? new TorusVerifier()
    : new TorusVerifier('0x4023d2a0D330bF11426B12C6144Cfb96B7fa6183', 'ropsten')
export default verifier

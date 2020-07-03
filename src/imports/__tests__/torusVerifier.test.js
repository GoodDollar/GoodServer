/**
 * @jest-environment node
 */
import { assign } from 'lodash'

import conf from '../../server/server.config'
import { recoverPublickey } from '../../server/utils/eth'
import torusVerifier from '../torusVerifier'
import createUserVerifier from '../../server/storage/verifier'

jest.setTimeout(20000)

describe('Test torus email/mobile to address', () => {
  //const strategies = ['google', 'google-old', 'auth0-pwdless-sms', 'auth0-pwdless-email']
  const strategies = ['auth0-pwdless-email']

  it('should get torus nodes', async () => {
    const nodes = await torusVerifier.fetchNodeDetails.getNodeDetails()

    expect(nodes).toMatchObject({
      nodeListAddress: '0x4023d2a0D330bF11426B12C6144Cfb96B7fa6183',
      torusNodeEndpoints: expect.any(Array)
    })
  })

  it('should get strategy options', async () => {
    strategies.forEach(torusType => {
      const z = torusVerifier.getVerificationOptions(torusType, { email: 'x@x.com', mobile: '+972505050' })

      expect(['x@x.com', '+972505050']).toContain(z.identifier)
      expect(z).toMatchObject({
        verifier: expect.any(String),
        emailVerified: expect.any(Boolean),
        mobileVerified: expect.any(Boolean)
      })
    })
  })

  it('should return public key for email/mobile', async () => {
    const { torusNodeEndpoints, torusNodePub } = await torusVerifier.fetchNodeDetails.getNodeDetails()

    await Promise.all(
      strategies.map(async torusType => {
        const opts = torusVerifier.getVerificationOptions(torusType, { email: 'x@gmail.com', mobile: '+972507319093' })

        const response = await torusVerifier.torus.getPublicAddress(
          torusNodeEndpoints,
          torusNodePub,
          { verifier: opts.verifier, verifierId: opts.identifier },
          false
        )

        expect([
          '0xD97b62EC3266EbA1F8F90Ba264174c138b5d4C38',
          '0x2916342DA5cF53ac9CfcBCdc7c6AB0405Ea5F439',
          '0xB5AD204135Ad58856a49CdA7351026c7e4906181'
        ]).toContain(response)
      })
    )
  })

  it('should recover signer correctly', async () => {
    const nonce = '1593455827517'
    const signature =
      '0xa7fb3a514469d038b0cda821977cd534eaed857f9cb7db5d4a6e843d55598bb80b66359ece24e626533b6cc9fea06abb95b7c152bef66a8b71a087f8e20987951c'

    const { identifier } = torusVerifier.getVerificationOptions('auth0-pwdless-sms', {
      email: 'x@d.com',
      mobile: '+972507319093'
    })
    const signedPublicKey = recoverPublickey(signature, identifier, nonce)

    expect(signedPublicKey).toEqual('0xD97b62EC3266EbA1F8F90Ba264174c138b5d4C38'.toLowerCase())
  })

  it('should modify userrecord if verified', async () => {
    const { verifyProof } = torusVerifier

    const userRecord = {
      smsValidated: false,
      isEmailConfirmed: true
    }

    const requestPayload = {
      torusProof: '0x0',
      torusProvider: 'google',
      torusProofNonce: 1
    }

    const userVerifier = createUserVerifier(userRecord, requestPayload, console)

    torusVerifier.verifyProof = jest.fn(() => ({
      mobileVerified: true,
      emailVerified: false
    }))

    try {
      await userVerifier.verifySignInIdentifiers()
    } finally {
      assign(torusVerifier, { verifyProof })
    }

    expect(userRecord).toEqual({
      smsValidated: true,
      isEmailConfirmed: true
    })
  })

  describe('mainnet tests', () => {
    let mainnetVerifier

    beforeAll(() => {
      const { torusNetwork, torusProxyContract } = conf

      assign(conf, { torusNetwork: 'mainnet', torusProxyContract: '0x638646503746d5456209e33a2ff5e3226d698bea' })
      mainnetVerifier = torusVerifier.constructor.factory()
      assign(conf, { torusNetwork, torusProxyContract })
    })

    it('should get torus nodes from mainnet', async () => {
      const nodes = await mainnetVerifier.fetchNodeDetails.getNodeDetails()

      expect(nodes).toMatchObject({
        nodeListAddress: '0x638646503746d5456209e33a2ff5e3226d698bea',
        torusNodeEndpoints: expect.any(Array)
      })
    })

    xit('should return public key for mainnet email/mobile', async () => {
      const { torusNodeEndpoints, torusNodePub } = await mainnetVerifier.fetchNodeDetails.getNodeDetails()

      const opts = mainnetVerifier.getVerificationOptions('google', {
        email: 'x@gmail.com',
        mobile: '+9720507319000'
      })

      const response = await mainnetVerifier.torus.getPublicAddress(
        torusNodeEndpoints,
        torusNodePub,
        { verifier: opts.verifier, verifierId: opts.identifier },
        false
      )

      expect([
        '0x59fFCACC9969441eB1514e984CF9430b720EF626',
        '0x2916342DA5cF53ac9CfcBCdc7c6AB0405Ea5F439',
        '0xB5AD204135Ad58856a49CdA7351026c7e4906181'
      ]).toContain(response)
    })
  })
})

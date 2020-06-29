/**
 * @jest-environment node
 */

import torusVerifier, { TorusVerifier } from '../torusVerifier'
jest.setTimeout(20000)
describe('Test torus email/mobile to address', () => {
  let mainnetVerifier
  beforeAll(() => {
    mainnetVerifier = new TorusVerifier('0x638646503746d5456209e33a2ff5e3226d698bea', 'mainnet')
    mainnetVerifier.initStrategies()
  })

  it('should get torus nodes', async () => {
    const nodes = await torusVerifier.fetchNodeDetails.getNodeDetails()
    expect(nodes).toMatchObject({
      nodeListAddress: '0x4023d2a0D330bF11426B12C6144Cfb96B7fa6183',
      torusNodeEndpoints: expect.any(Array)
    })
  })

  it('should get torus nodes from mainnet', async () => {
    const nodes = await mainnetVerifier.fetchNodeDetails.getNodeDetails()
    expect(nodes).toMatchObject({
      nodeListAddress: '0x638646503746d5456209e33a2ff5e3226d698bea',
      torusNodeEndpoints: expect.any(Array)
    })
  })

  it('should get strategy options', async () => {
    ;['google', 'google-old', 'auth0-pwdless-sms', 'auth0-pwdless-email'].forEach(torusType => {
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
      ['google', 'google-old', 'auth0-pwdless-sms', 'auth0-pwdless-email'].map(async torusType => {
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

  xit('should return public key for mainnet email/mobile', async () => {
    const { torusNodeEndpoints, torusNodePub } = await mainnetVerifier.fetchNodeDetails.getNodeDetails()
    await Promise.all(
      ['google'].map(async torusType => {
        const opts = mainnetVerifier.getVerificationOptions(torusType, {
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
    )
  })
})

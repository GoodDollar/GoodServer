import { get } from 'lodash'
import request from 'supertest'
import { sha3 } from 'web3-utils'

import UserDBPrivate from '../../db/mongo/user-privat-provider'

import makeServer from '../../server-test'
import { getCreds, getToken } from '../../__util__'

describe('goodidAPI', () => {
  let server
  let token
  let creds
  const issueLocationCertificateUri = '/goodid/certificate/location'
  const verifyCertificateUri = '/goodid/certificate/verify'

  const assertCountryCode =
    code =>
    ({ body }) => {
      const { countryCode } = get(body, 'ceriticate.credentialSubject', {})

      if (countryCode !== code) {
        throw new Error(`expected ${code}, got ${countryCode}`)
      }
    }

  const setUserData = ({ mobile, ...data }) =>
    UserDBPrivate.updateUser({
      identifier: creds.address,
      mobile: mobile ? sha3(mobile) : null,
      ...data
    })

  const testIPUA = '178.158.235.10'
  const testIPBR = '130.185.238.1'

  const testLocationPayloadUA = {
    timestamp: 1707313563,
    coords: {
      longitude: 30.394171,
      latitude: 50.328899,
      accuracy: null,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    }
  }

  const testUserPayloadUA = {
    mobile: '+380639549357'
  }

  const testUserPayloadBR = {
    mobile: '+5531971416384'
  }

  const testCertificate = {
    credentialSubject: {
      countryCode: 'UA',
      id: 'did:ethr:0x7ac080f6607405705aed79675789701a48c76f55'
    },
    issuer: { id: 'did:key:z6MktGpZnw8NtAjmvQdsyiMAHwCJYzq5kBAS2yWyoX1DVoFe' },
    type: ['VerifiableCredential', 'VerifiableLocationCredential'],
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    issuanceDate: '2024-02-28T22:35:11.000Z',
    proof: {
      type: 'JwtProof2020',
      jwt: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiVmVyaWZpYWJsZUxvY2F0aW9uQ3JlZGVudGlhbCJdLCJjcmVkZW50aWFsU3ViamVjdCI6eyJjb3VudHJ5Q29kZSI6IlVBIn19LCJzdWIiOiJkaWQ6ZXRocjoweDdhYzA4MGY2NjA3NDA1NzA1YWVkNzk2NzU3ODk3MDFhNDhjNzZmNTUiLCJuYmYiOjE3MDkxNTk3MTEsImlzcyI6ImRpZDprZXk6ejZNa3RHcFpudzhOdEFqbXZRZHN5aU1BSHdDSll6cTVrQkFTMnlXeW9YMURWb0ZlIn0.VWQKMqFoZvpGzXheDV3H9N7XaVEe4E0jmQgRQ3isKfyJwHPQm5I0W77nRimYyd4Km9iz4UUTWhVrkXHVffj4Cw'
    }
  }

  beforeAll(async () => {
    jest.setTimeout(50000)
    server = await makeServer()
    creds = await getCreds()
    token = await getToken(server, creds)

    console.log('goodidAPI: server ready')
    console.log({ server })
  })

  beforeEach(async () => {
    await setUserData({
      mobile: null,
      smsValidated: false
    })
  })

  afterAll(async () => {
    await new Promise(res =>
      server.close(err => {
        console.log('verificationAPI: closing server', { err })
        res()
      })
    )
  })

  test('GoodID endpoints returns 401 without credentials', async () => {
    await Promise.all(
      [issueLocationCertificateUri, verifyCertificateUri].map(uri => request(server).post(uri).send({}).expect(401))
    )
  })

  test('Location certificate: should fail on empty data', async () => {
    await request(server)
      .post(issueLocationCertificateUri)
      .send({})
      .set('Authorization', `Bearer ${token}`)
      .expect(400, {
        success: false,
        error: 'Failed to verify location: missing geolocation data'
      })
  })

  test('Location certificate: should fail if geo data does not match IP', async () => {
    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPBR)
      .expect(400, {
        success: false,
        error: 'Country of Your IP address does not match geolocation data'
      })
  })

  test('Location certificate: should issue from geo data', async () => {
    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPUA)
      .expect(200)
      .expect(assertCountryCode('UA'))
  })

  test('Location certificate: should ignore mobile if not match', async () => {
    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        user: testUserPayloadBR,
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPUA)
      .expect(200)
      .expect(assertCountryCode('UA'))
  })

  test('Location certificate: should ignore mobile if not verified', async () => {
    await setUserData({
      mobile: testUserPayloadBR.mobile,
      smsValidated: false
    })

    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        user: testUserPayloadBR,
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPUA)
      .expect(200)
      .expect(assertCountryCode('UA'))
  })

  test('Location certificate: should issue from mobile ignoring geo data if it matches and verified', async () => {
    await setUserData({
      mobile: testUserPayloadBR.mobile,
      smsValidated: true
    })

    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        user: testUserPayloadBR,
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPUA)
      .expect(200)
      .expect(assertCountryCode('BR'))

    // should not throw because of IP => GEO mismatch
    await setUserData({
      mobile: testUserPayloadUA.mobile
    })

    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        user: testUserPayloadUA,
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPBR)
      .expect(200)
      .expect(assertCountryCode('UA'))
  })

  test('Verify certificate: should fail on empty data', async () => {
    await request(server).post(verifyCertificateUri).send({}).set('Authorization', `Bearer ${token}`).expect(400, {
      success: false,
      error: 'Failed to verify credential: missing certificate data'
    })
  })

  test('Verify certificate: should verify credential', async () => {
    await request(server)
      .post(verifyCertificateUri)
      .send({
        certificate: testCertificate
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200, {
        success: true
      })
  })
})

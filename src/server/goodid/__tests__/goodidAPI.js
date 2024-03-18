import { get } from 'lodash'
import { sha3 } from 'web3-utils'

import request from 'supertest'
import MockAdapter from 'axios-mock-adapter'

import storage from '../../db/mongo/user-privat-provider'
import createEnrollmentProcessor from '../../verification/processor/EnrollmentProcessor'

import makeServer from '../../server-test'
import { getCreds, getToken } from '../../__util__'
import createFvMockHelper from '../../verification/api/__tests__/__util__'
import { enrollmentNotFoundMessage } from '../../verification/utils/constants'
import { normalizeIdentifiers } from '../../verification/utils/utils'

//import testFaceMock from './face.json'

describe('goodidAPI', () => {
  let server
  let token
  let creds

  let fvMock
  let fvMockHelper
  const enrollmentProcessor = createEnrollmentProcessor(storage)

  const issueLocationCertificateUri = '/goodid/certificate/location'
  const issueIdentityCertificateUri = '/goodid/certificate/identity'
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
    storage.updateUser({
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

  //const testEnrollmentIdentifier = '0x5efe0a7c45d3a07ca7faf5c09c62eee8bb944e1087594b2b951e00fb29f8318912bd8b8b0d72ddf34d99ed0eeb3574237c7ba02e8b74ae6ed107b5337e8df79e1c'

  //https://goodid.gooddollar.org/?account=0xc218C7bB7F87a544EB7dCC9D776131A75E362d9C&chain=122&fvsig=0x5efe0a7c45d3a07ca7faf5c09c62eee8bb944e1087594b2b951e00fb29f8318912bd8b8b0d72ddf34d99ed0eeb3574237c7ba02e8b74ae6ed107b5337e8df79e1c&firstname=Oleksii+Serdiukov&rdu=http%3A%2F%2Flocalhost%3A3000%2Fhome%2Fgooddollar

  beforeAll(async () => {
    jest.setTimeout(50000)

    creds = await getCreds(true)
    await storage.addUser({ identifier: creds.address })

    server = await makeServer()
    token = await getToken(server, creds)

    fvMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    fvMockHelper = createFvMockHelper(fvMock)

    console.log('goodidAPI: server ready')
    console.log({ server })
  })

  beforeEach(async () => {
    fvMock.reset()

    await setUserData({
      mobile: null,
      smsValidated: false
    })
  })

  afterAll(async () => {
    await storage.deleteUser({ identifier: creds.address })

    await new Promise(res =>
      server.close(err => {
        console.log('verificationAPI: closing server', { err })
        res()
      })
    )
  })

  test('GoodID endpoints returns 401 without credentials', async () => {
    await Promise.all(
      [issueLocationCertificateUri, issueIdentityCertificateUri, verifyCertificateUri].map(uri =>
        request(server).post(uri).send({}).expect(401)
      )
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

  test('Identity certificate: should fail on empty data', async () => {
    await request(server)
      .post(issueIdentityCertificateUri)
      .send({})
      .set('Authorization', `Bearer ${token}`)
      .expect(400, {
        success: false,
        error: 'Failed to verify identify: missing face verification ID'
      })
  })

  test('Identity certificate: should fail if face id does not matches g$ account', async () => {
    const { status, body } = await request(server)
      .post(issueIdentityCertificateUri)
      .send({
        enrollmentIdentifier:
          '0x5efe0a7c45d3a07ca7faf5c09c62eee8bb944e1087594b2b951e00fb29f8318912bd8b8b0d72ddf34d99ed0eeb3574237c7ba02e8b74ae6ed107b5337e8df79e1c'
      })
      .set('Authorization', `Bearer ${token}`)

    expect(status).toBe(400)
    expect(body).toHaveProperty('success', false)
    expect(body).toHaveProperty('error')
    expect(body.error).toStartWith("Identifier signer doesn't match user")
  })

  test('Identity certificate: should fail if face record does not exist', async () => {
    const enrollmentIdentifier = creds.fvV2Identifier
    const { v2Identifier } = normalizeIdentifiers(enrollmentIdentifier)

    fvMockHelper.mockEnrollmentNotFound(v2Identifier)

    await request(server)
      .post(issueIdentityCertificateUri)
      .send({ enrollmentIdentifier })
      .set('Authorization', `Bearer ${token}`)
      .expect(400, {
        success: false,
        error: enrollmentNotFoundMessage
      })
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

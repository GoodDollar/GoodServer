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

import GoodIDUtils from '../utils'

import facePhotoMock from './face.json'
import { getSubjectId } from '../veramo'
import { getRecognitionClient, getS3Client } from '../aws'

describe('goodidAPI', () => {
  let server
  let token
  let creds

  let fvMock
  let fvMockHelper
  const enrollmentProcessor = createEnrollmentProcessor(storage)

  let utilsHttpMock

  let detectFaces
  let detectFacesMock = jest.fn()
  const awsClient = getRecognitionClient()

  let sendCommand
  let sendCommandMock = jest.fn()
  const s3Client = getS3Client()

  const issueLocationCertificateUri = '/goodid/certificate/location'
  const issueIdentityCertificateUri = '/goodid/certificate/identity'
  const verifyCertificateUri = '/goodid/certificate/verify'
  const registerRedtentUri = '/goodid/redtent'

  const mockReverseGeoCoding = response =>
    utilsHttpMock.onGet('https://nominatim.openstreetmap.org/reverse').reply(200, response)

  const mockGeoIP = response =>
    utilsHttpMock.onGet(/^https:\/\/get\.geojs\.io\/v1\/ip\/country\//i).reply(200, response)

  const assertCountryCode =
    code =>
    ({ body }) => {
      const { countryCode } = get(body, 'certificate.credentialSubject', {})

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

  const testIPResponseUA = {
    ip: '178.158.235.10',
    name: 'Ukraine',
    country: 'UA',
    country_3: 'UKR'
  }

  const testIPResponseBR = {
    ip: '130.185.238.1',
    name: 'Brazil',
    country: 'BR',
    country_3: 'BRA'
  }

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

  const testLocationResponseUA = {
    place_id: 203448753,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    osm_type: 'way',
    osm_id: 200457494,
    lat: '50.32483516659043',
    lon: '34.43836126361775',
    category: 'highway',
    type: 'secondary',
    place_rank: 26,
    importance: 0.10000999999999993,
    addresstype: 'road',
    name: 'Т-17-05',
    display_name: 'Т-17-05, Husarshchyna, Комишанська сільська громада, Okhtyrka Raion, Sumy Oblast, 42720, Ukraine',
    address: {
      road: 'Т-17-05',
      village: 'Husarshchyna',
      municipality: 'Комишанська сільська громада',
      district: 'Okhtyrka Raion',
      state: 'Sumy Oblast',
      'ISO3166-2-lvl4': 'UA-59',
      postcode: '42720',
      country: 'Ukraine',
      country_code: 'ua'
    },
    boundingbox: ['50.3073554', '50.3462975', '34.4033829', '34.4677591']
  }

  const testUserPayloadUA = {
    mobile: '+380639549357'
  }

  const testUserPayloadBR = {
    mobile: '+5531971416384'
  }

  const testLocationCertificate = {
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

  const testIdentityCertificate = {
    credentialSubject: {
      unique: true,
      age: { min: 30 },
      gender: 'Female',
      id: 'did:ethr:0x7ac080f6607405705aed79675789701a48c76f55'
    },
    issuer: { id: 'did:key:z6MktGpZnw8NtAjmvQdsyiMAHwCJYzq5kBAS2yWyoX1DVoFe' },
    type: [
      'VerifiableCredential',
      'VerifiableIdentityCredential',
      'VerifiableGenderCredential',
      'VerifiableAgeCredential'
    ],
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    issuanceDate: '2024-04-15T14:07:43.000Z',
    proof: {
      type: 'JwtProof2020',
      jwt: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiVmVyaWZpYWJsZUlkZW50aXR5Q3JlZGVudGlhbCIsIlZlcmlmaWFibGVHZW5kZXJDcmVkZW50aWFsIiwiVmVyaWZpYWJsZUFnZUNyZWRlbnRpYWwiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsidW5pcXVlIjp0cnVlLCJhZ2UiOnsibWluIjozMH0sImdlbmRlciI6IkZlbWFsZSJ9fSwic3ViIjoiZGlkOmV0aHI6MHg3YWMwODBmNjYwNzQwNTcwNWFlZDc5Njc1Nzg5NzAxYTQ4Yzc2ZjU1IiwibmJmIjoxNzEzMTkwMDYzLCJpc3MiOiJkaWQ6a2V5Ono2TWt0R3Babnc4TnRBam12UWRzeWlNQUh3Q0pZenE1a0JBUzJ5V3lvWDFEVm9GZSJ9.X5bvv4aKjsEj4HAwi4lbgYkjTijJeHTJbJeHZ1tyRRa7_EZ6Kb1WfoiyUCKCbi1HnAl6WMK9Ty1hL4MzlDslAQ'
    }
  }

  const testLocationCertificateNG = {
    credentialSubject: {
      countryCode: 'NG',
      id: 'did:ethr:0x7ac080f6607405705aed79675789701a48c76f55'
    },
    issuer: { id: 'did:key:z6MktGpZnw8NtAjmvQdsyiMAHwCJYzq5kBAS2yWyoX1DVoFe' },
    type: ['VerifiableCredential', 'VerifiableLocationCredential'],
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    issuanceDate: '2024-04-15T14:07:43.000Z',
    proof: {
      type: 'JwtProof2020',
      jwt: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiVmVyaWZpYWJsZUxvY2F0aW9uQ3JlZGVudGlhbCJdLCJjcmVkZW50aWFsU3ViamVjdCI6eyJjb3VudHJ5Q29kZSI6Ik5HIn19LCJzdWIiOiJkaWQ6ZXRocjoweDdhYzA4MGY2NjA3NDA1NzA1YWVkNzk2NzU3ODk3MDFhNDhjNzZmNTUiLCJuYmYiOjE3MTMxOTAwNjMsImlzcyI6ImRpZDprZXk6ejZNa3RHcFpudzhOdEFqbXZRZHN5aU1BSHdDSll6cTVrQkFTMnlXeW9YMURWb0ZlIn0.ByYgCor62J7DhCiO8-DbDGm77c-0Qtf1LtSHrorm0ff8qhx2fg3gbQoJJk19nF7YaPSniqnc0qsmMCRf1EYICg'
    }
  }

  const testVideoFilename = '0x7ac080f6607405705aed79675789701a48c76f55.webm'

  beforeAll(async () => {
    jest.setTimeout(50000)

    detectFaces = awsClient.detectFaces
    awsClient.detectFaces = detectFacesMock

    sendCommand = s3Client.send
    s3Client.send = sendCommandMock

    creds = await getCreds(true)
    await storage.addUser({ identifier: creds.address })

    server = await makeServer()
    token = await getToken(server, creds)

    fvMock = new MockAdapter(enrollmentProcessor.provider.api.http)
    fvMockHelper = createFvMockHelper(fvMock)

    utilsHttpMock = new MockAdapter(GoodIDUtils.http)

    console.log('goodidAPI: server ready')
    console.log({ server })
  })

  beforeEach(async () => {
    await setUserData({
      mobile: null,
      smsValidated: false
    })
  })

  afterEach(() => {
    fvMock.reset()
    utilsHttpMock.reset()
    detectFacesMock.mockReset()
    sendCommandMock.mockReset()
  })

  afterAll(async () => {
    awsClient.detectFaces = detectFaces
    s3Client.send = sendCommand

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
      [issueLocationCertificateUri, issueIdentityCertificateUri].map(uri =>
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
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseBR)

    await request(server)
      .post(issueLocationCertificateUri)
      .send({
        geoposition: testLocationPayloadUA
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', testIPBR)
      .expect(400, {
        success: false,
        error: 'location could not be verified'
      })
  })

  test('Location certificate: should issue from geo data', async () => {
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseUA)

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
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseUA)

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
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseUA)

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
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseUA)

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
    utilsHttpMock.reset()
    mockReverseGeoCoding(testLocationResponseUA)
    mockGeoIP(testIPResponseBR)

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
    expect(body.error).toStartWith('FV identifier signature verification faild')
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

  test('Identity certificate: should issue certificate from face image', async () => {
    const enrollmentIdentifier = creds.fvV2Identifier
    const { v2Identifier } = normalizeIdentifiers(enrollmentIdentifier)

    fvMockHelper.mockEnrollmentFound(v2Identifier, facePhotoMock)

    detectFacesMock.mockReturnValue({
      promise: async () => ({
        FaceDetails: [
          {
            Gender: {
              Value: 'Male'
            },
            AgeRange: {
              Low: 30
            }
          }
        ]
      })
    })

    const { status, body } = await request(server)
      .post(issueIdentityCertificateUri)
      .send({ enrollmentIdentifier })
      .set('Authorization', `Bearer ${token}`)

    expect(status).toBe(200)
    expect(body).toHaveProperty('success', true)

    expect(body).toHaveProperty('certificate.type', [
      'VerifiableCredential',
      'VerifiableIdentityCredential',
      'VerifiableGenderCredential',
      'VerifiableAgeCredential'
    ])

    expect(body).toHaveProperty('certificate.credentialSubject', {
      id: getSubjectId(creds.address),
      unique: true,
      gender: 'Male',
      age: { min: 30 }
    })
  })

  test('Verify certificate: should fail on empty data', async () => {
    await request(server).post(verifyCertificateUri).send({}).expect(400, {
      success: false,
      error: 'Failed to verify credential: missing certificate data'
    })
  })

  test('Verify certificate: should verify credential', async () => {
    await request(server)
      .post(verifyCertificateUri)
      .send({
        certificate: testLocationCertificate
      })
      .expect(200, {
        success: true
      })
  })

  test('Redtent register: should fail on empty data', async () => {
    await request(server).post(registerRedtentUri).send({}).expect(400, {
      success: false,
      error: 'Failed to verify: missing certificate data'
    })

    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testLocationCertificate] })
      .expect(400, {
        success: false,
        error: 'Failed to verify: missing file name of the video uploaded to the bucket'
      })
  })

  test('Redtent register: should fail with certificates issued for different accounts', async () => {
    const { credentialSubject } = testLocationCertificate

    const mutatedClone = {
      ...testLocationCertificate,
      credentialSubject: {
        ...credentialSubject,
        id: credentialSubject.id.replace(/6f55$/, '7066')
      }
    }

    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testLocationCertificate, mutatedClone], videoFilename: testVideoFilename })
      .expect(400, {
        success: false,
        error: 'Certificates issued for the different accounts'
      })
  })

  test('Redtent register: should fail without identity certificate', async () => {
    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testLocationCertificate], videoFilename: testVideoFilename })
      .expect(400, {
        success: false,
        error: 'Failed to verify: certificates are missing uniqueness credential'
      })
  })

  test('Redtent register: should fail with if location/gender not allowed by the pool', async () => {
    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testIdentityCertificate, testLocationCertificate], videoFilename: testVideoFilename })
      .expect(400, {
        success: false,
        error: 'Failed to verify: allowed for the Nigerian/Colombian accounts owned by women only'
      })
  })

  test.skip('Redtent register: should fail if filename does not match account', async () => {
    await request(server)
      .post(registerRedtentUri)
      .send({
        certificates: [testIdentityCertificate, testLocationCertificateNG],
        videoFilename: testVideoFilename.replace(/6f55/i, '7066')
      })
      .expect(400, {
        success: false,
        error: 'Uploaded file name does not match account'
      })
  })

  test('Redtent register: should fail if file does not exists', async () => {
    sendCommandMock.mockRejectedValue()

    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testIdentityCertificate, testLocationCertificateNG], videoFilename: testVideoFilename })
      .expect(400, {
        success: false,
        error: 'Uploaded file does not exist at S3 bucket'
      })
  })

  test('Redtent register: should register if all certificates and filename matches account, creds are valid, file exists and gender/location are allowed by the pool', async () => {
    sendCommandMock.mockResolvedValue()

    await request(server)
      .post(registerRedtentUri)
      .send({ certificates: [testIdentityCertificate, testLocationCertificateNG], videoFilename: testVideoFilename })
      .expect(200, { success: true })
  })
})

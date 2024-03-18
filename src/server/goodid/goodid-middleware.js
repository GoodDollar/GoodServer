// @flow

import { Router } from 'express'
import passport from 'passport'
import requestIp from 'request-ip'
import { sha3 } from 'web3-utils'

import { wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import { get } from 'lodash'
import { Credential } from './veramo'
import createEnrollmentProcessor from '../verification/processor/EnrollmentProcessor'
import { enrollmentNotFoundMessage } from '../verification/utils/constants'
import { normalizeIdentifiers, verifyIdentifier } from '../verification/utils/utils'

const { Location, Gender, Age, Identity } = Credential

export default function addGoodIDMiddleware(app: Router, utils, storage) {
  /**
   * POST /goodid/certificate/location
   * Content-Type: application/json
   * {
   *   "user": { // optional
   *      "mobile": "+380639549357"
   *    },
   *   "geoposition": { // a GeolocationPosition returned from navigator.geolocation.getCurrentPosition()
   *     "timestamp": 1707313563,
   *     "coords": {
   *       "longitude": 30.394171,
   *       "latitude": 50.328899,
   *       "accuracy": null,
   *       "altitude": null,
   *       "altitudeAccuracy": null,
   *       "heading": null,
   *       "speed": null,
   *     }
   *   }
   * }
   *
   * HTTP/1.1 200 OK
   * Content-Type: application/json
   * {
   *   "success": true,
   *   "certificate": {
   *     "credential": {
   *       "credentialSubject": {
   *         "id": 'did:ethr:<g$ wallet address>',
   *         "countryCode": "<2-chars upercased>"
   *       },
   *       "issuer": {
   *         "id": 'did:key:<GoodServer's DID>',
   *       },
   *       "type": ["VerifiableCredential", "VerifiableLocationCredential"],
   *       "@context": ["https://www.w3.org/2018/credentials/v1"],
   *       "issuanceDate": "2022-10-28T11:54:22.000Z",
   *       "proof": {
   *         "type": "JwtProof2020",
   *         "jwt": 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7InlvdSI6IlJvY2sifX0sInN1YiI6ImRpZDp3ZWI6ZXhhbXBsZS5jb20iLCJuYmYiOjE2NjY5NTgwNjIsImlzcyI6ImRpZDpldGhyOmdvZXJsaToweDAzNTBlZWVlYTE0MTBjNWIxNTJmMWE4OGUwZmZlOGJiOGEwYmMzZGY4NjhiNzQwZWIyMzUyYjFkYmY5M2I1OWMxNiJ9.EPeuQBpkK13V9wu66SLg7u8ebY2OS8b2Biah2Vw-RI-Atui2rtujQkVc2t9m1Eqm4XQFECfysgQBdWwnSDvIjw',
   *       },
   *     },
   *   }
   * }
   */
  app.post(
    '/goodid/certificate/location',
    requestRateLimiter(10, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, body, log } = req
      const { mobile } = get(body, 'user', {})
      const { mobile: mobileHash, smsValidated, gdAddress } = user
      const { longitude, latitude } = get(body, 'geoposition.coords', {})

      const issueCertificate = async countryCode => {
        const certificate = await utils.issueCertificate(gdAddress, Location, { countryCode })

        res.json({ success: true, certificate })
      }

      try {
        if (mobile) {
          const countryCodeFromMobile = utils.getCountryCodeFromMobile(mobile)
          const isPhoneMatchesAndVerified = smsValidated && mobileHash === sha3(mobile)

          if (isPhoneMatchesAndVerified) {
            await issueCertificate(countryCodeFromMobile)
            return
          }
        }

        if (!longitude && !latitude) {
          throw new Error('Failed to verify location: missing geolocation data')
        }

        const clientIp = requestIp.getClientIp(req)

        log.debug('Getting country data', { clientIp, longitude, latitude })

        const [countryCodeFromIP, countryCodeFromLocation] = await Promise.all([
          utils.getCountryCodeFromIPAddress(clientIp),
          utils.getCountryCodeFromGeoLocation(latitude, longitude)
        ])

        if (countryCodeFromIP !== countryCodeFromLocation) {
          throw new Error('Country of Your IP address does not match geolocation data')
        }

        await issueCertificate(countryCodeFromIP)
      } catch (exception) {
        const { message } = exception

        log.error('Failed to issue location ceritifate:', message, exception, { mobile, longitude, latitude })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * POST /goodid/certificate/identity
   * Content-Type: application/json
   * {
   *   "enrollmentIdentifier": "<v2 identifier string>",
   *   "fvSigner": "<v1 identifier string>", // optional
   * }
   *
   * HTTP/1.1 200 OK
   * Content-Type: application/json
   * {
   *   "success": true,
   *   "certificate": {
   *     "credential": {
   *       "credentialSubject": {
   *         "id": 'did:ethr:<g$ wallet address>',
   *         "gender": "<Male | Female>" // yep, AWS doesn't supports LGBT,
   *         "age": {
   *           "min": <years>, // "open" ranges also allowed, e.g. { to: 7 } or { from: 30 }
   *           "max": <years>,   // this value includes to the range, "from 30" means 30 and older, if < 30 you will get "from 25 to 29"
   *         }
   *       },
   *       "issuer": {
   *         "id": 'did:key:<GoodServer's DID>',
   *       },
   *       "type": ["VerifiableCredential", "VerifiableIdentityCredential", "VerifiableAgeCredential", "VerifiableGenderCredential"],
   *       "@context": ["https://www.w3.org/2018/credentials/v1"],
   *       "issuanceDate": "2022-10-28T11:54:22.000Z",
   *       "proof": {
   *         "type": "JwtProof2020",
   *         "jwt": 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7InlvdSI6IlJvY2sifX0sInN1YiI6ImRpZDp3ZWI6ZXhhbXBsZS5jb20iLCJuYmYiOjE2NjY5NTgwNjIsImlzcyI6ImRpZDpldGhyOmdvZXJsaToweDAzNTBlZWVlYTE0MTBjNWIxNTJmMWE4OGUwZmZlOGJiOGEwYmMzZGY4NjhiNzQwZWIyMzUyYjFkYmY5M2I1OWMxNiJ9.EPeuQBpkK13V9wu66SLg7u8ebY2OS8b2Biah2Vw-RI-Atui2rtujQkVc2t9m1Eqm4XQFECfysgQBdWwnSDvIjw',
   *       },
   *     },
   *   }
   * }
   */
  app.post(
    '/goodid/certificate/identity',
    requestRateLimiter(10, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, body, log } = req
      const { enrollmentIdentifier, fvSigner } = body
      const { gdAddress } = user

      try {
        const processor = createEnrollmentProcessor(storage, log)

        if (!enrollmentIdentifier) {
          throw new Error('Failed to verify identify: missing face verification ID')
        }

        const { v2Identifier, v1Identifier } = normalizeIdentifiers(enrollmentIdentifier, fvSigner)

        verifyIdentifier(enrollmentIdentifier, gdAddress)

        // here we check if wallet was registered using v1 of v2 identifier
        const [isV2, isV1] = await Promise.all([
          processor.isIdentifierExists(v2Identifier),
          v1Identifier && processor.isIdentifierExists(v1Identifier)
        ])

        const faceIdentifier = isV2 ? v2Identifier : isV1 ? v1Identifier : null

        if (!faceIdentifier) {
          throw new Error(enrollmentNotFoundMessage)
        }

        const { auditTrailBase64 } = await processor.getEnrollment(faceIdentifier, log)
        const estimation = await utils.ageGenderCheck(auditTrailBase64)

        const certificate = await utils.issueCertificate(gdAddress, [Identity, Gender, Age], {
          unique: true,
          ...estimation
        })

        res.json({ success: true, certificate })
      } catch (exception) {
        const { message } = exception

        log.error('Failed to issue identity ceritifate:', message, exception, {
          enrollmentIdentifier,
          fvSigner
        })

        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * POST /goodid/certificate/verify
   * Content-Type: application/json
   * {
   *   "certificate": {
   *     "credentialSubject": {
   *       "id": 'did:ethr:<g$ wallet address>',
   *       "countryCode": "<2-chars upercased>"
   *     },
   *     "issuer": {
   *       "id": 'did:key:<GoodServer's DID>',
   *     },
   *     "type": ["VerifiableCredential", <set of VerifiableLocationCredential | VerifiableIdentityCredential | VerifiableGenderCredential | VerifiableAgeCredential items>],
   *     "@context": ["https://www.w3.org/2018/credentials/v1"],
   *     "issuanceDate": "2022-10-28T11:54:22.000Z",
   *     "proof": {
   *       "type": "JwtProof2020",
   *       "jwt": 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7InlvdSI6IlJvY2sifX0sInN1YiI6ImRpZDp3ZWI6ZXhhbXBsZS5jb20iLCJuYmYiOjE2NjY5NTgwNjIsImlzcyI6ImRpZDpldGhyOmdvZXJsaToweDAzNTBlZWVlYTE0MTBjNWIxNTJmMWE4OGUwZmZlOGJiOGEwYmMzZGY4NjhiNzQwZWIyMzUyYjFkYmY5M2I1OWMxNiJ9.EPeuQBpkK13V9wu66SLg7u8ebY2OS8b2Biah2Vw-RI-Atui2rtujQkVc2t9m1Eqm4XQFECfysgQBdWwnSDvIjw',
   *     },
   *   }
   * }
   *
   * HTTP/1.1 200 OK
   * Content-Type: application/json
   * {
   *   "success": true
   * }
   */
  app.post(
    '/goodid/certificate/verify',
    requestRateLimiter(10, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { body, log } = req
      const { certificate } = body ?? {}

      try {
        if (!certificate) {
          throw new Error('Failed to verify credential: missing certificate data')
        }

        const success = await utils.verifyCertificate(certificate)

        res.status(200).json({ success })
      } catch (exception) {
        const { message } = exception

        log.error('Failed to verify ceritifate:', message, exception, { certificate })
        res.status(400).json({ success: false, error: message })
      }
    })
  )
}

/*

app.post(
  '/verify/agegender',
  passport.authenticate('jwt', { session: false }),
  requestRateLimiter(1, 1),
  wrapAsync(async (req, res) => {
    const { user, log } = req
    let { v1Identifier, v2Identifier } = req.body
    const { gdAddress } = user

    const zoomProvider = getZoomProvider()

    // for v2 identifier - verify that identifier is for the address we are going to whitelist
    await verifyFVIdentifier(v2Identifier, gdAddress)

    // TODO: processor & normalize
    v2Identifier = v2Identifier.slice(0, 42)
    v1Identifier = v1Identifier.replace('0x', '') // wallet will also supply the v1 identifier as fvSigner, we remove '0x' for public address

    // here we check if wallet was registered using v1 of v2 identifier
    const [recordV2, recordV1] = await Promise.all([
      zoomProvider.getEnrollment(v2Identifier, log),
      v1Identifier && zoomProvider.getEnrollment(v1Identifier, log)
    ])

    const record = recordV2 || recordV1
    if (!record) throw new Error('face record not found')
    const { auditTrailBase64 } = record
    const { FaceDetails } = await detectFaces(auditTrailBase64)
    log.info({ FaceDetails })
    await Promise.all([
      // semaphore.enrollAge(FaceDetails[0].AgeRange),
      // semaphore.enrollGender(FaceDetails[0].Gender.Value)
    ])

    res.json({ ok: 1 })
  })
)*/

// @flow

import { Router } from 'express'
import passport from 'passport'
import requestIp from 'request-ip'
import { sha3 } from 'web3-utils'

import { wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import { get } from 'lodash'
import { Credential } from './veramo'

export default function addGoodIDMiddleware(app: Router, utils) {
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
   *       "type": ['VerifiableLocationCredential'],
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
        const ceriticate = await utils.issueCertificate(gdAddress, Credential.Location, { countryCode })

        res.json({ success: true, ceriticate })
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
}

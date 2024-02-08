// @flow

import { Router } from 'express'
import passport from 'passport'
import requestIp from 'request-ip'
import { sha3 } from 'web3-utils'

import { wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import { get } from 'lodash'

export default function addGoodIDMiddleware(app: Router, utils) {
  /**
   * POST /goodid/certificate/location
   * Content-Type: application/json
   * {
   *   "user": {
   *      "mobile": "+380639549357"
   *    },
   *   "geoposition": {
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
   */
  app.post(
    '/goodid/certificate/location',
    requestRateLimiter(10, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, body, log } = req
      const { mobile } = get(body, 'user', {})
      const { mobile: mobileHash, smsValidated } = user
      const { longitude, latitude } = get(body, 'geoposition.coords', {})

      const issueCertificate = async countryCode => {
        const ceriticate = await utils.issueCertificate(countryCode)

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
        const countryCodeFromIP = await utils.getCountryCodeFromIPAddress(clientIp)
        const countryCodeFromLocation = await utils.getCountryCodeFromGeoLocation(latitude, longitude)
        const isCountryFromIPMatchesLocation = countryCodeFromIP === countryCodeFromLocation

        if (!isCountryFromIPMatchesLocation) {
          throw new Error('Country of Your IP address does not match geolocation data')
        }

        await issueCertificate(countryCodeFromIP)
      } catch (exception) {
        const { message } = exception

        log.error('Failed to issue location ceritifate:', message, exception, { mobile, longitude, latitude })
        res.status(400).json({ ok: 0, error: message })
      }
    })
  )
}

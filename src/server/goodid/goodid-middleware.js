// @flow

import type { StorageAPI } from '../../imports/types'

import { Router } from 'express'
import passport from 'passport'
import requestIp from 'request-ip'

import { wrapAsync } from '../utils/helpers'
import requestRateLimiter from '../utils/requestRateLimiter'
import { get } from 'lodash'

export default function addGoodIDMiddleware(app: Router, storage: StorageAPI, utils) {
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
      const { body, log } = req
      const { mobile } = get(body, 'user', {})
      const { longitude, latitude } = get(body, 'geoposition.coords', {})
      const clientIp = requestIp.getClientIp(req)

      const issueCertificate = async countryCode => {
        const ceriticate = await utils.issueCertificate(countryCode)

        res.json({ success: true, ceriticate })
      }

      try {
        if (!longitude && !latitude) {
          throw new Error('Failed to verify location: missing geolocation data')
        }

        const countryCodeFromIP = await utils.getCountryCodeFromIPAddress(clientIp)
        const countryCodeFromLocation = await utils.getCountryCodeFromGeoLocation(latitude, longitude)
        const isCountryFromIPMatchesLocation = countryCodeFromIP === countryCodeFromLocation

        if (mobile) {
          const countryCodeFromMobile = utils.getCountryCodeFromMobile(mobile)
          const isPhoneMatchesAndVerified = false // TODO: check it

          if (isPhoneMatchesAndVerified) {
            await issueCertificate(countryCodeFromMobile)
            return
          }
        }

        if (!isCountryFromIPMatchesLocation) {
          throw new Error('Country of Your IP address does not match geolocation data')
        }

        await issueCertificate(countryCodeFromIP)
      } catch (exception) {
        const { message } = exception

        log.error('Failed to issue location ceritifate:', message, exception, { mobile, longitude, latitude, clientIp })
        res.status(400).json({ ok: 0, error: message })
      }
    })
  )
}

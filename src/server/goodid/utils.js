import axios from 'axios'
import { PhoneNumberUtil } from 'google-libphonenumber'

import { substituteParams } from '../utils/axios'
import { flatten, get, toUpper } from 'lodash'
import { getAgent, getSubjectId } from './veramo'

export class GoodIDUtils {
  constructor(httpApi, phoneNumberApi, getVeramoAgent) {
    const http = httpApi.create({})
    const { request, response } = http.interceptors

    request.use(req => substituteParams(req))
    response.use(({ data }) => data)

    this.http = http
    this.phoneUtil = phoneNumberApi.getInstance()
    this.getVeramoAgent = getVeramoAgent
  }

  async getCountryCodeFromIPAddress(ip) {
    const countryCode = await this.http
      .get('https://get.geojs.io/v1/ip/country/:ip.json', { ip })
      .then(response => get(response, 'country_3'))

    if (!countryCode) {
      throw new Error(`Failed to get country code from IP address '${ip}': response is empty or invalid`)
    }

    return countryCode
  }

  async getCountryCodeFromGeoLocation(latitude, longitude) {
    const countryCode = await this.http
      .get('https://nominatim.openstreetmap.org/reverse', {
        format: 'jsonv2',
        lat: latitude,
        lon: longitude
      })
      .then(response => get(response, 'address.country_code'))
      .then(toUpper)

    if (!countryCode) {
      throw new Error(
        `Failed to get country code from coordinates '${latitude}:${longitude}': response is empty or invalid`
      )
    }

    return countryCode
  }

  getCountryCodeFromMobile(phoneNumber) {
    const { phoneUtil } = this
    const number = phoneUtil.parseAndKeepRawInput(phoneNumber, 'US')

    if (!phoneUtil.isValidNumber(number)) {
      throw new Error(`Failed to get country code from mobile '${phoneNumber}': Invalid phone number`)
    }

    return phoneUtil.getRegionCodeForNumber(number)
  }

  async issueCertificate(gdAddress, credentials, payload = {}) {
    const agent = await this.getVeramoAgent()
    const identifier = await agent.didManagerGetByAlias({ alias: 'default' })

    return agent.createVerifiableCredential({
      credential: {
        type: flatten([credentials]), // instead of the ternary flow isArray ? x : [x]
        issuer: { id: identifier.did },
        credentialSubject: {
          id: getSubjectId(gdAddress),
          ...payload
        }
      },
      proofFormat: 'jwt'
    })
  }
}

export default new GoodIDUtils(axios, PhoneNumberUtil, getAgent)

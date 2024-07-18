import axios from 'axios'
import { PhoneNumberUtil } from 'google-libphonenumber'
import { basename, extname } from 'path'

import { substituteParams } from '../utils/axios'
import logger from '../../imports/logger'
import { assign, every, flatten, get, isUndefined, negate, pickBy, toUpper, map, uniq } from 'lodash'
import { getAgent, getSubjectAccount, getSubjectId } from './veramo'
import { REDTENT_BUCKET, detectFaces, getS3Metadata } from './aws'

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
      .get('https://get.geojs.io/v1/ip/country/:ip.json', { params: { ip } })
      .catch(error => {
        throw new Error(`Failed to get country code from IP address '${ip}': ${error.message}`)
      })
      .then(response => get(response, 'country'))

    if (!countryCode) {
      throw new Error(`Failed to get country code from IP address '${ip}': response is empty or invalid`)
    }

    return countryCode
  }

  async getCountryCodeFromGeoLocation(latitude, longitude) {
    const countryCode = await fetch(
      'https://nominatim.openstreetmap.org/reverse?' +
        new URLSearchParams({
          format: 'jsonv2',
          lat: latitude,
          lon: longitude
        }).toString(),
      { headers: { referer: 'https://wallet.gooddollar.org' } }
    )
      .catch(error => {
        throw new Error(`Failed to get country code from coordinates': ${error.message}`)
      })
      .then(async response => {
        if (response.status != 200) {
          logger.warn('Failed reverse geolocation http request', {
            latitude,
            longitude,
            response: await response.text()
          })
          throw new Error(`'Failed reverse geolocation http request: ${response.status} ${response.statusText}`)
        }
        return response.json()
      })
      .then(response => get(response, 'address.country_code'))
      .then(toUpper)

    if (!countryCode) {
      throw new Error(`Failed to get country code from coordinates: response is empty or invalid`)
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

  async ageGenderCheck(imageBase64) {
    const { FaceDetails } = await detectFaces(imageBase64)
    const [{ AgeRange, Gender }] = FaceDetails

    const { Value: gender } = Gender
    const { Low: min, High: max } = AgeRange

    const age = pickBy({ min, max }, negate(isUndefined)) // filter up undefined

    return { gender, age }
  }

  async issueCertificate(gdAddress, credentials, payload = {}) {
    const agent = await this.getVeramoAgent()
    const identifier = await agent.didManagerGetByAlias({ alias: 'default' })

    return agent.createVerifiableCredential({
      credential: {
        type: flatten(['VerifiableCredential', credentials]), // instead of the ternary flow isArray ? x : [x]
        issuer: { id: identifier.did },
        credentialSubject: {
          id: getSubjectId(gdAddress),
          ...payload
        }
      },
      proofFormat: 'jwt'
    })
  }

  async verifyCertificate(certificate) {
    const agent = await this.getVeramoAgent()
    const { verified } = await agent.verifyCredential({ credential: certificate })

    return verified
  }

  // verifies all certificates
  // checks they issued for the same account
  // fetches account as wallet address from subject id
  // and returns all merged subjects with account data
  async aggregateCredentials(certificates) {
    const subjects = map(certificates, 'credentialSubject')
    const subjectIds = subjects.map(({ id }) => id.toLowerCase())

    // check all beling the same account
    if (uniq(subjectIds).length > 1) {
      throw new Error('Certificates issued for the different accounts')
    }

    const verifiedStatuses = await Promise.all(certificates.map(item => this.verifyCertificate(item)))

    // check were all verified or not
    if (!every(verifiedStatuses)) {
      throw new Error('Some of the certificates have different issuer, is invalid or was failed to verify')
    }

    const [id] = subjectIds
    const account = getSubjectAccount(id)

    return assign({ id, account }, ...subjects)
  }

  async checkS3AccountVideo(videoFilename, account) {
    const filename = basename(videoFilename, extname(videoFilename)).toLowerCase()

    if (filename !== account) {
      throw new Error('Uploaded file name does not match account')
    }

    await getS3Metadata(videoFilename, REDTENT_BUCKET).catch(() => {
      throw new Error('Uploaded file does not exist at S3 bucket')
    })
  }
}

export default new GoodIDUtils(axios, PhoneNumberUtil, getAgent)

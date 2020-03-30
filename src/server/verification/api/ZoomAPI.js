import axios from 'axios'
import Config from '../../server.config'

const { zoomLicenseKey, zoomServerBaseUrl } = Config

class ZoomAPI {
  http = null

  constructor(http) {
    this.http = http
  }

  async submitEnrollment(payload) {
    const { http, _getResponse } = this
    const { userAgent, ...requestPayload } = payload

    const request = http.post('/enrollment', requestPayload, {
      headers: {
        'X-User-Agent': userAgent
      }
    })

    const response = await _getResponse(request)

    const { code, glasses, message, isEnrolled, isLowQuality } = response

    if (200 !== code || !isEnrolled) {
      let errorMessage = 'The FaceMap was not enrolled because '

      if (isLowQuality) {
        errorMessage += 'the photoshoots evaluated to be of poor quality.'
      } else if (glasses) {
        errorMessage += 'wearing glasses were detected.'
      } else {
        errorMessage = message
      }

      const exception = new Error(errorMessage)

      exception.response = response
      throw exception
    }

    return response
  }

  async _getResponse(httpRequest) {
    let response

    try {
      response = await httpRequest
    } catch (exception) {
      response = exception.response

      if (!response) {
        throw exception
      }
    }

    const { meta, data } = response.data

    return { ...meta, ...data }
  }
}

export default new ZoomAPI(
  axios.create({
    baseURL: zoomServerBaseUrl,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      'X-Device-License-Key': zoomLicenseKey
    }
  })
)

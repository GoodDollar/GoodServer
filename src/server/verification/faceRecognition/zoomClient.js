// @flow
import fetch from 'cross-fetch'
import logger from '../../../imports/pino-logger'
import Config from '../../server.config'
const log = logger.child({ from: 'ZoomClient' })

export const ZoomClient = {
  baseUrl: Config.zoomURL,
  baseHeaders: {
    'X-App-Token': Config.zoomToken
  },
  baseQuery(url, headers, data: FromData) {
    const fullUrl = `${this.baseUrl}${url}`

    return fetch(fullUrl, { method: 'post', body: data, headers })
      .then(async res => {
        log.debug('Response:', url, { res })
        return res.json()
      })
      .catch(e => {
        log.error('Error:', url, e, { data })
        throw e
      })
  },

  liveness(data: FormData) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    return this.baseQuery('/liveness', this.baseHeaders, data)
  },
  search(data: FormData) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    // log.debug('search data:', { data })
    return this.baseQuery('/search', this.baseHeaders, data)
  },
  enrollment(data: FormData) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    // log.debug('enrollment data:', { data })
    return this.baseQuery('/enrollment', this.baseHeaders, data)
  }
}

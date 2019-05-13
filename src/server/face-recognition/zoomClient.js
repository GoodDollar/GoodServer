// @flow
import fetch from 'cross-fetch'
import logger from '../../imports/pino-logger'

import { UserRecord } from '../../imports/types'
import Config from '../server.config'

import FormData from 'form-data'

const log = logger.child({ from: 'ZoomClient' })
export type ZoomRequest = {
  sessionId: string,
  facemap: Blob,
  enrollmentIdentifier?: string,
  minMatchLevel?: number
}
export const ZoomClient = {
  baseUrl: Config.zoomURL,
  baseHeaders: {
    'X-App-Token': Config.zoomToken
  },
  baseQuery(url, headers, data: ZoomRequest) {
    const fullUrl = `${this.baseUrl}${url}`

    return fetch(fullUrl, { method: 'post', body: data, headers })
      .then(async res => {
        log.debug('Response:', { res })
        if (res.status !== 200) throw new Error(await res.text())
        return res.json()
      })
      .catch(e => {
        log.error('Error:', url, e, { data })
        throw e
      })
  },

  liveness(data: ZoomRequest) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    return this.baseQuery('/liveness', this.baseHeaders, data)
  },
  search(data: ZoomRequest) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    log.debug('search data:', { data })
    return this.baseQuery('/search', this.baseHeaders, data)
  },
  enrollment(data: ZoomRequest) {
    this.baseHeaders['Content-Type'] = `multipart/form-data; boundary=${data._boundary}`
    log.debug('enrollment data:', { data })
    return this.baseQuery('/enrollment', this.baseHeaders, data)
  }
}

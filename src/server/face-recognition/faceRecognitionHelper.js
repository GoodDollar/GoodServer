// @flow
import fs, { ReadStream } from 'fs'
import _ from 'lodash'
import FormData from 'form-data'
import Config from '../server.config'
import { ZoomClient } from './zoomClient'
import logger from '../../imports/pino-logger'
import type { ZoomRequest } from './zoomClient'

const log = logger.child({ from: 'faceRecognitionHelper' })

export const Helper = {
  prepareLivenessData(body: any, files: any) {
    // log.info({ files })
    let form = new FormData()
    const facemapfile = _.find(files, { fieldname: 'facemap' }).path
    const auditTrailImagefile = _.find(files, { fieldname: 'auditTrailImage' }).path
    const facemap = fs.createReadStream(facemapfile)
    const auditTrailImage = fs.createReadStream(auditTrailImagefile)
    const enrollmentIdentifier = body.enrollmentIdentifier
    const sessionId = body.sessionId
    log.debug('body', { body })
    form.append('sessionId', sessionId)
    form.append('facemap', facemap)
    form.append('auditTrailImage', auditTrailImage)
    return { form, facemap, facemapfile, auditTrailImage, enrollmentIdentifier, sessionId }
  },

  prepareSearchData(sessionId: string, facemapfile: string) {
    let form = new FormData()
    const facemap = fs.createReadStream(facemapfile)

    log.debug('preparing search data', sessionId, Config.zoomMinMatchLevel)
    form.append('facemap', facemap)
    form.append('sessionId', sessionId)
    form.append('minMatchLevel', Config.zoomMinMatchLevel)
    log.debug('done preparing search data')

    return form
  },

  async isLivenessPassed(zoomData: ZoomRequest) {
    try {
      let res = await ZoomClient.liveness(zoomData)
      log.debug({ res })
      return res.meta.ok && res.data.livenessResult === 'passed' && res.data.livenessScore > 50
    } catch (e) {
      log.error('Error:', e, { zoomData })
      return false
    }
  },

  async isDuplicatesExist(zoomData: ZoomRequest) {
    try {
      let res = await ZoomClient.search(zoomData)
      log.debug({ res })
      return res.meta.ok && res.data.results.length !== 0
    } catch (e) {
      log.error('Error:', e, Config.zoomMinMatchLevel, { zoomData })
      return false
    }
  }
}

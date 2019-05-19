// @flow
import fs from 'fs'
import _ from 'lodash'
import FormData from 'form-data'
import Config from '../../server.config'
import logger from '../../../imports/pino-logger'
import { ZoomClient } from './zoomClient'
const log = logger.child({ from: 'faceRecognitionHelper' })

export type VerificationData = {
  sessionId: string,
  facemapFile: string,
  auditTrailImageFile: string,
  enrollmentIdentifier?: string,
  minMatchLevel?: number
}

export type EnrollResult = {
  enrollmentIdentifier: string,
  livenessResult: 'passed' | 'failed',
  livenessScore: number,
  glassesScore: number,
  glassesDecision: boolean,
  retryFeedbackSuggestion: number,
  facemapIsLowQuality: boolean,
  createDate: Date,
  creationStatusFromZoomServer: string | null,
  errorFromZoomServer: string | null,
  alreadyEnrolled: boolean
}

const Helper = {
  prepareLivenessData(data: VerificationData) {
    let form = new FormData()
    const facemap = fs.createReadStream(data.facemapFile)
    const auditTrailImage = fs.createReadStream(data.auditTrailImageFile)
    const sessionId = data.sessionId
    // log.debug('body', { body })
    form.append('sessionId', sessionId)
    form.append('facemap', facemap)
    form.append('auditTrailImage', auditTrailImage)
    return form
  },

  prepareSearchData(data: VerificationData) {
    let form = new FormData()
    const facemap = fs.createReadStream(data.facemapFile)
    form.append('facemap', facemap)
    form.append('sessionId', data.sessionId)
    // form.append('minMatchLevel', 2)
    return form
  },

  prepareEnrollmentData(data: VerificationData) {
    let form = new FormData()
    const facemap = fs.createReadStream(data.facemapFile)
    form.append('facemap', facemap)
    form.append('sessionId', data.sessionId)
    form.append('enrollmentIdentifier', data.enrollmentIdentifier)

    return form
  },

  async isLivenessPassed(zoomData: FormData) {
    try {
      let res = await ZoomClient.liveness(zoomData)
      log.debug('liveness result:', { res })
      return res.meta.ok && res.data.livenessResult === 'passed' && res.data.livenessScore > 50
    } catch (e) {
      log.error('Error:', e, { zoomData })
      throw e
    }
  },

  async isDuplicatesExist(zoomData: FormData, identifier: string) {
    try {
      let res = await ZoomClient.search(zoomData)
      log.debug('search result:', { res })
      return (
        res.data.results.length > 0 && _.find(res.data.results, { enrollmentIdentifier: identifier }) === undefined // if found matches - verify it's not the user itself
      )
    } catch (e) {
      log.error('Error:', e, Config.zoomMinMatchLevel, { zoomData })
      throw e
    }
  },

  async enroll(zoomData: FormData): EnrollResult {
    try {
      let res = await ZoomClient.enrollment(zoomData)
      log.debug('enroll result:', { res })
      if (res.meta.ok) return res.data
      if (res.meta.subCode === 'nameCollision') return { alreadyEnrolled: true }
      else return false
    } catch (e) {
      log.error('Error:', e, { zoomData })
      throw e
    }
  }
}

export default Helper

// @flow
import Axios from 'axios'

import Config from '../../server.config'
import logger from '../../../imports/logger'

import { ZoomAPI } from '../api/ZoomAPI'
import { IdScanRequest, IdScanResult } from './typings'
import { UserRecord } from '../../../imports/types'

class IdScanProcessor {
  logger = null
  storage = null

  constructor(storage, logger) {
    this.logger = logger
    this.storage = storage
    this.api = new ZoomAPI(Config, Axios.create, logger.child({ from: 'ZoomAPI' }))
  }

  async verify(user: UserRecord, enrollmentIdentifier: string, payload: IdScanRequest): Promise<IdScanResult> {
    const result = await this.api.idscan(enrollmentIdentifier, payload, this.logger)
    const { matchLevel } = result
    const isMatch = Number(matchLevel) > 0
    return { ...result, isMatch }
  }
}

const idscanProcessors = new WeakMap()
const createIdScanProcessor = (storage, log): IdScanProcessor => {
  if (!idscanProcessors.has(storage)) {
    log = log || logger.child({ from: 'IdScanProcessor' })
    const idscanProcessor = new IdScanProcessor(storage, log)
    idscanProcessors.set(storage, idscanProcessor)
  }

  return idscanProcessors.get(storage)
}
export default createIdScanProcessor

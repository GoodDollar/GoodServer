// @flow
import { humanApi, kairosAPI } from 'express-kairos-faceverification'
import conf from '../../server.config'

const apiKairos = new kairosAPI({ app_id: conf.kairos.id, app_key: conf.kairos.key }, 'test', true)

const humanInstance = new humanApi(
  apiKairos,
  {
    livenessThresh: 0.8,
    uniqueThresh: 0.7,
    minEnrollImages: 1,
    maxHeadAngle: 10,
    minPhashSimilarity: 0.95
  },
  true
)

export default humanInstance

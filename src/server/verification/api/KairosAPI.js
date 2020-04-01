// @flow
import { humanApi, kairosAPI } from 'express-kairos-faceverification' // eslint-disable-line
import conf from '../../server.config'
const { id: app_id, key: app_key } = conf.kairos

const apiKairos = new kairosAPI({ app_id, app_key }, 'test', true)

export default new humanApi(apiKairos, conf.humanOptions, true)

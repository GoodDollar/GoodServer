// @flow

import REK from 'aws-sdk/clients/rekognition'
import { once } from 'lodash'

import conf from '../server.config'

export const getRecognitionClient = once(() => {
  const { awsSesAccessKey, awsSesSecretAccessKey, awsSesRegion } = conf

  if (!awsSesAccessKey || !awsSesRegion || !awsSesSecretAccessKey) {
    throw new Error('Missing AWS configuration')
  }

  return new REK({
    region: awsSesRegion,
    accessKeyId: awsSesAccessKey,
    secretAccessKey: awsSesSecretAccessKey
  })
})

export const detectFaces = async imageBase64 => {
  const payload = {
    Attributes: ['AGE_RANGE', 'GENDER'],
    Image: {
      Bytes: Buffer.from(imageBase64, 'base64')
    }
  }

  return getRecognitionClient().detectFaces(payload).promise()
}

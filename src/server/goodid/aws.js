// @flow

import REK from 'aws-sdk/clients/rekognition'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { once } from 'lodash'

import conf from '../server.config'

const getConfig = (service: 'ses' | 's3' | 'rek') => {
  const { awsSesAccessKey, awsSesSecretAccessKey, awsSesRegion, awsS3Region } = conf
  let region

  switch (service) {
    case 'ses':
    case 'rek':
      region = awsSesRegion
      break
    case 's3':
      region = awsS3Region
      break
    default:
      throw new Error(`AWS service ${service} not supported`)
  }

  if (!awsSesAccessKey || !awsSesSecretAccessKey || !region) {
    throw new Error('Missing AWS configuration')
  }

  return {
    accessKeyId: awsSesAccessKey,
    secretAccessKey: awsSesSecretAccessKey,
    region
  }
}

export const REDTENT_BUCKET = 'redtent'

export const getS3Client = once(() => {
  const { region, ...credentials } = getConfig('s3')

  return new S3Client({ region, credentials })
})

export const getRecognitionClient = once(() => new REK(getConfig('rek')))

export const detectFaces = async imageBase64 => {
  const rekognition = getRecognitionClient()

  const payload = {
    Attributes: ['AGE_RANGE', 'GENDER'],
    Image: {
      Bytes: Buffer.from(imageBase64, 'base64')
    }
  }

  return rekognition.detectFaces(payload).promise()
}

export const getS3Metadata = async (filename, bucket) => {
  const s3 = getS3Client()

  const payload = {
    Bucket: bucket,
    Key: filename
  }

  return s3.send(new HeadObjectCommand(payload))
}

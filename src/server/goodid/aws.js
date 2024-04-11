// @flow

import REK from 'aws-sdk/clients/rekognition'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { once } from 'lodash'

import conf from '../server.config'

export const REDTENT_BUCKET = 'redtent'

export const getS3Client = once(
  () =>
    new S3Client({
      region: 'us-east-1',
      signer: { sign: async request => request }
    })
)

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

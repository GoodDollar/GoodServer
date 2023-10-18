// @flow
import REK from 'aws-sdk/clients/rekognition'
import conf from '../server.config'

const accessKeyId = conf.awsSesAccessKey
const secretAccessKey = conf.awsSesSecretAccessKey
const region = conf.awsSesRegion

const runInEnv = ['production', 'staging'].includes(conf.env)

if (runInEnv) {
  if (!accessKeyId || !secretAccessKey || !region) {
    throw new Error('Missing AWS configuration')
  }
}

const REK_CONFIG = {
  accessKeyId,
  secretAccessKey,
  region
}

const rek = new REK(REK_CONFIG)

export const detectFaces = async imageBase64 => {
  const buf = Buffer.from(imageBase64, 'base64')
  const params = {
    Image: {
      /* required */
      Bytes: buf
    },
    Attributes: ['AGE_RANGE', 'GENDER']
  }
  try {
    const result = await rek.detectFaces(params).promise()
    console.log({ result })
    return result
  } catch (e) {
    console.log(e)
  }
}

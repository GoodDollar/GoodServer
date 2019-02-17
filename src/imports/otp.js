// @flow
import random from 'math-random'
import * as plivo from 'plivo'
import conf from '../server/server.config'
import type { UserRecord } from './types'
import logger from './pino-logger'

const generateOTP = (digits: number = 0): number => {
  const log = logger.child({ from: 'generateOTP' })
  const exponent = digits - 1
  const base = Number(`1e${exponent}`)
  const multiplier = Number(`9e${exponent}`)
  log.debug(exponent, base, multiplier)

  return Math.floor(base + random() * multiplier)
}

const sendOTP = (user: UserRecord): Promise<any> => {
  const { plivoAuthID, plivoAuthToken, plivoPhoneNumber } = conf
  const { mobile } = user
  const client = new plivo.Client(plivoAuthID, plivoAuthToken)
  const otp = generateOTP(conf.otpDigits)
  return Promise.all([client.messages.create(plivoPhoneNumber, mobile, otp), otp])
}

export { generateOTP, sendOTP }

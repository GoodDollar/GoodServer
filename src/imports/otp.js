// @flow
import random from 'math-random'
import * as plivo from 'plivo'
import conf from '../server/server.config'
import type { UserRecord } from './types'

/**
 * Creates an OTP code and returns it as a string
 * @param {number} length - length of OTP code
 * @returns {string}
 */
const generateOTP = (length: number = 0): string => {
  const exponent = length - 1
  const base = Number(`1e${exponent}`)
  const multiplier = Number(`9e${exponent}`)

  return Math.floor(base + random() * multiplier).toString()
}

/**
 * Sends an OTP code to the user's mobile number
 * @param {UserRecord} user - object with user's information
 * @returns {Promise<$TupleMap<*[], typeof $await>>}
 */
const sendOTP = (user: UserRecord): Promise<any> => {
  const { plivoAuthID, plivoAuthToken, plivoPhoneNumber } = conf
  const { mobile } = user
  const client = new plivo.Client(plivoAuthID, plivoAuthToken)
  const otp = generateOTP(conf.otpDigits)
  const msg = 'Your GoodDollar Verification Code Is: ' + otp
  return Promise.all([client.messages.create(plivoPhoneNumber, mobile, msg), otp])
}

export { generateOTP, sendOTP }

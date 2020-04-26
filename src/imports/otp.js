// @flow
import random from 'math-random'
// import * as plivo from 'plivo'
import Twilio from 'twilio'
import conf from '../server/server.config'
import type { UserRecord } from './types'

/**
 * Creates an OTP code and returns it as a string
 * @param {number} length - length of OTP code
 * @returns {string}
 */
export const generateOTP = (length: number = 0): string => {
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
export const sendOTP = (user: UserRecord): Promise<any> => {
  const { twilioAuthID, twilioAuthToken, twilioPhoneNumber } = conf
  const { mobile } = user

  const client = Twilio(twilioAuthID, twilioAuthToken)

  const otp = generateOTP(conf.otpDigits)
  const msg = 'Your GoodDollar Verification Code Is: ' + otp
  return Promise.all([client.messages.create({ to: mobile, from: twilioPhoneNumber, body: msg }), otp])
}

/**
 * Sends an magic code to the user's mobile number
 * @param {String} to - users's mobile number
 * @param {String} code - magic code to be send to user
 * @returns {Promise<any>}
 */
// export const sendMagicCodeBySMS = async (to, code) => {
//   const { twilioAuthID, twilioAuthToken, twilioPhoneNumber } = conf
//   const client = Twilio(twilioAuthID, twilioAuthToken)
//   const msg = 'Open the GoodDollar app you just installed and paste this code:'
//
//   await client.messages.create({ to, from: twilioPhoneNumber, body: msg })
//   await client.messages.create({ to, from: twilioPhoneNumber, body: code })
// }

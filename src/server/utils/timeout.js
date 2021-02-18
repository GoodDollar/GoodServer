import { promisify } from 'util'

const promisifiedTimeout = promisify(setTimeout)

export const timeout = async (millis, errorMessage = null) => {
  await promisifiedTimeout(millis)

  if (errorMessage) {
    throw new Error(errorMessage)
  }
}

// eslint-disable-next-line require-await
export const delay = async millis => timeout(millis)

export default async function requestTimeout(millis, timeoutReason = null) {
  let errorMessage = 'Request timeout'

  if (timeoutReason) {
    errorMessage += `: ${timeoutReason}`
  }

  await timeout(millis, errorMessage)
}

Promise.timeout = (promise, timeout, timeoutReason) => Promise.race([promise, requestTimeout(timeout, timeoutReason)])

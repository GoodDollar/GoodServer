import { promisify } from 'util'
import { defer, from as fromPromise, timer } from 'rxjs'
import { retryWhen, mergeMap, throwError } from 'rxjs/operators'
import { constant } from 'lodash'

const promisifiedTimeout = promisify(setTimeout)

export const noopAsync = async () => {}

export const timeout = async (millis, errorMessage = null) => {
  await promisifiedTimeout(millis)

  if (errorMessage) {
    throw new Error(errorMessage)
  }
}

// eslint-disable-next-line require-await
export const delay = async millis => timeout(millis)

export const requestTimeout = async (millis, timeoutReason = null) => {
  let errorMessage = 'Request timeout'

  if (timeoutReason) {
    errorMessage += `: ${timeoutReason}`
  }

  await timeout(millis, errorMessage)
}

export const withTimeout = (promise, millis, timeoutReason = null) =>
  Promise.race([promise, requestTimeout(millis, timeoutReason)])

export const retry = (asyncFn, retries = 1, interval = 0, onRetry = null) =>
  defer(() => fromPromise(asyncFn()))
    .pipe(
      retryWhen(attempts =>
        attempts.pipe(
          mergeMap((reason, index) => {
            const shouldRetry = onRetry || constant(true)

            if (shouldRetry(reason)) {
              const retryAttempt = index + 1

              if (retryAttempt <= retries) {
                return timer(interval || 0)
              }
            }

            return throwError(reason)
          })
        )
      )
    )
    .toPromise()

import { isError, isNumber, isFunction } from 'lodash'
import { defer, from as fromPromise, timer } from 'rxjs'
import { retryWhen, mergeMap, throwError, timeout as rxTimeout } from 'rxjs/operators'
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

export const requestTimeout = async (millis, timeoutReason = null) => {
  let errorMessage = 'Request timeout'

  if (timeoutReason) {
    errorMessage += `: ${timeoutReason}`
  }

  await timeout(millis, errorMessage)
}

export const retry = (source, retries = 5, interval = 0, shouldRetry = () => true) => {
  const observable = isFunction(source) ? defer(() => fromPromise(source())) : source

  return observable
    .pipe(
      retryWhen(attempts =>
        attempts.pipe(
          mergeMap((attempt, index) => {
            if (shouldRetry(attempt)) {
              const retryAttempt = index + 1

              if (!isNumber(retries) || retries <= 0 || retryAttempt <= retries) {
                return timer(interval || 0)
              }
            }

            return throwError(attempt)
          })
        )
      )
    )
    .toPromise()
}

// eslint-disable-next-line
export const retryTimeout = (asyncFn, timeout = 10000, retries = 1, interval = 0) =>
  retry(
    defer(() => fromPromise(asyncFn())).pipe(rxTimeout(timeout)),
    retries,
    interval,
    error => isError(error) && 'TimeoutError' === error.name
  )

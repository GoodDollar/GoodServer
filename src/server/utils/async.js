import { promisify } from 'util'
import { defer, from as fromPromise, timer, throwError } from 'rxjs'
import { retryWhen, mergeMap } from 'rxjs/operators'
import { constant, first, isFunction, noop } from 'lodash'

const defaultOnFallback = () => true
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

export const retry = (asyncFn, retries = 1, interval = 0, onRetry = null) => {
  let retryAttempt = 1

  return defer(() => fromPromise(asyncFn(retryAttempt)))
    .pipe(
      retryWhen(attempts =>
        attempts.pipe(
          mergeMap(reason => {
            const shouldRetry = onRetry || constant(true)

            if (shouldRetry(reason) && (retries < 0 || retryAttempt <= retries)) {
              retryAttempt += 1
              return timer(interval || 0)
            }

            return throwError(reason)
          })
        )
      )
    )
    .toPromise()
}

export const fallback = async (asyncFns, onFallback = defaultOnFallback) => {
  if (asyncFns.length < 2) {
    // if no function passed - return undefined
    // if one function passed - immediately return its value
    // because reducer will return fn itself without invocation
    // passiing Promise.resolve as initial accumulator won't help
    // as we're reducing fns only in .catch
    return (first(asyncFns) || noop)()
  }

  return asyncFns.reduce(async (current, next) => {
    let promise = current

    if (isFunction(current)) {
      promise = current()
    }

    // eslint-disable-next-line require-await
    return promise.catch(async error => {
      if (!onFallback(error)) {
        throw error
      }

      return next()
    })
  })
}

export const makePromiseWrapper = () => {
  let resolve
  let reject

  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const callback = (error, result) => {
    if (error) {
      reject(error)
    } else {
      resolve(result)
    }
  }

  return { promise, resolve, reject, callback }
}

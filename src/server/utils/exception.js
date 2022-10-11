import { cloneDeep, get, has, keys } from 'lodash'

import { propertyDescriptor } from './object'

export const cloneErrorObject = exception => {
  // Create a new error...
  const err = new exception.constructor(exception.message)

  // If a `stack` property is present, copy it over...
  if (exception.stack) {
    err.stack = exception.stack
  }

  // Node.js specific (system errors)...
  if (exception.code) {
    err.code = exception.code
  }

  if (exception.errno) {
    err.errno = exception.errno
  }

  if (exception.syscall) {
    err.syscall = exception.syscall
  }

  // Any enumerable properties...
  const errKeys = keys(exception)

  for (let key of errKeys) {
    const desc = propertyDescriptor(exception, key)

    if (has(desc, 'value')) {
      desc.value = cloneDeep(exception[key])
    }

    Object.defineProperty(exception, key, desc)
  }

  return err
}

export const messageContains = (e, substring) => {
  const message = String(get(e, 'message', ''))

  return message.toLowerCase().includes(substring.toLowerCase())
}

import { assign, omit } from 'lodash'

export default sourceError => {
  const { message, name, code, stack } = sourceError
  const error = new Error(message)
  let stackDescriptor = Object.getOwnPropertyDescriptor(error, 'stack')

  assign(error, { name, code })
  stackDescriptor = omit(stackDescriptor, 'value', 'writable')
  Object.defineProperty(error, 'stack', { ...stackDescriptor, get: () => stack })

  return error
}

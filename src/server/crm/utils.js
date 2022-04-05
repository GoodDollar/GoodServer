import { escapeRegExp } from 'lodash'

export const shouldUpdateEmail = (email, newEmail) => {
  if (newEmail) {
    const emailRe = new RegExp(`^${escapeRegExp(newEmail)}$`, 'i')

    return !emailRe.test(email || '')
  }

  return false
}

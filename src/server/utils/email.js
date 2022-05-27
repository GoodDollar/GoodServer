import { encode } from 'punycode/'

export const punycodeDomain = email => {
  const splittedEmail = email.split('@')
  const domain = splittedEmail.pop()

  return splittedEmail.join('@').concat(encode(domain))
}

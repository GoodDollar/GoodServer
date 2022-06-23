import { encode } from 'punycode'

const AT = '@'
// eslint-disable-next-line no-control-regex
const ASCII_REGEX = /^[\u0000-\u007f]*$/

export const punycodeDomain = email => {
  const [username, domain] = email.split(AT)
  const encodedDomain = ASCII_REGEX.test(domain) ? domain : encode(domain)

  return [username, encodedDomain].join(AT)
}

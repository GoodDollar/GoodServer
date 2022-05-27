import { encode } from 'punycode'

const AT = '@'

export const punycodeDomain = email => {
  const [username, domain] = email.split(AT)

  return [username, encode(domain)].join(AT)
}

// @flow

import { isPlainObject, memoize, template } from 'lodash'

const templateFactory = memoize(tmplString => template(tmplString, { interpolate: /{(\S+?)}/g }))

export const mustache = (tmplString, variables = null) => {
  const templateFn = templateFactory(tmplString)

  return isPlainObject(variables) ? templateFn(variables) : templateFn
}

// POSIX case-insensitive string comparisons
// int strcasecmp(const char *s1, const char *s2);
export const strcasecmp = (s1: string, s2: string): integer =>
  (s1 || '').localeCompare(s2 || '', undefined, { sensitivity: 'accent' })

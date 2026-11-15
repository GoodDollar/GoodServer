// @flow

/**
 * Strips line breaks from user-provided strings before they are written to the logs, so a caller cannot forge
 * additional log entries (log injection). Non-string values are returned untouched.
 */
export const sanitizeLog = (value: any): any => (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ') : value)

export default sanitizeLog

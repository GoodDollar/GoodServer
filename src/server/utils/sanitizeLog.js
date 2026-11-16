// @flow

/**
 * Converts a user-provided value to a string and replaces its line breaks before it is written to the logs, so a
 * caller cannot forge additional log entries (log injection).
 */
export const sanitizeLog = (value: any): string => String(value).replace(/\n|\r/g, '')

export default sanitizeLog

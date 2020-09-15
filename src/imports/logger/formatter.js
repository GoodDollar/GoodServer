// @flow

import winston from 'winston'
import errorSerializer from 'pino-std-serializers/lib/err'
import { isError, isPlainObject, omit, keys, flatten, assign, uniq } from 'lodash'
import { SPLAT, LEVEL } from 'triple-beam'

const { printf, colorize } = winston.format
const colorizer = colorize()

export const extended = () =>
  printf(({ level, timestamp, from, userId, ...rest }) => {
    const context = rest[SPLAT] || []
    // objects passed to log.debug are merged with log record causing duplicates
    // going over SPLAT (logged args) and excluding keys of the all objects logged
    const excludeKeys = flatten(context.map(value => (isPlainObject(value) ? keys(value) : [])))
    // excluding symbols SPLAT and LEVEL, adding logged args as 'context' property
    const logPayload = assign(omit(rest, [SPLAT, LEVEL, ...uniq(excludeKeys)]), { context })
    const fromString = from ? ` (FROM ${from} ${userId || ''})` : ''

    const stringifiedPayload = JSON.stringify(logPayload, (_, value) =>
      isError(value) ? errorSerializer(value) : value
    )

    const logMessage = `${timestamp} - workerId:${global.workerId} - ${level}${fromString}: ${stringifiedPayload}`

    return colorizer.colorize(level, logMessage)
  })

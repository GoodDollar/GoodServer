// @flow

import winston from 'winston'
import errorSerializer from 'pino-std-serializers/lib/err'
import { isError, isArray, first } from 'lodash'
import { SPLAT } from 'triple-beam'

const { printf, colorize } = winston.format
const colorizer = colorize()

const getLogPayload = logRecord => {
  const { message, uuid, ...rest } = logRecord
  let context = rest[SPLAT]

  if (isArray(context)) {
    context = first(context)
  }

  return { message, context: { uuid, ...context } }
}

export const extended = () =>
  printf(logRecord => {
    const { level, timestamp, from, userId } = logRecord
    const userString = userId ? ` ${userId}` : ''
    const fromString = from ? ` (FROM ${from}${userString})` : ''
    const logPayload = getLogPayload(logRecord)

    const stringifiedPayload = JSON.stringify(logPayload, (_, value) =>
      isError(value) ? errorSerializer(value) : value
    )

    const logMessage = `${timestamp} - workerId:${global.workerId} - ${level}${fromString}: ${stringifiedPayload}`

    return colorizer.colorize(level, logMessage)
  })

// @flow

import winston from 'winston'
import errorSerializer from 'pino-std-serializers/lib/err'
import { isError } from 'lodash'
import { SPLAT, LEVEL } from 'triple-beam'

const { printf, colorize } = winston.format
const colorizer = colorize()

export const extended = () =>
  printf(({ level, timestamp, from, userId, uuid, message, ...rest }) => {
    const logPayload = { uuid, message, context: rest[SPLAT] || [] }
    const fromString = from ? ` (FROM ${from} ${userId || ''})` : ''

    const stringifiedPayload = JSON.stringify(logPayload, (_, value) =>
      isError(value) ? errorSerializer(value) : value
    )

    const logMessage = `${timestamp} - workerId:${global.workerId} - ${level}${fromString}: ${stringifiedPayload}`

    return colorizer.colorize(level, logMessage)
  })

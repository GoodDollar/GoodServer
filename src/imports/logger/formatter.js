// @flow

import winston from 'winston'
import errorSerializer from 'pino-std-serializers/lib/err'
import { isError, isArray, upperFirst } from 'lodash'
import { SPLAT } from 'triple-beam'

const { printf, colorize } = winston.format
const colorizer = colorize()

export const extended = () =>
  printf(({ level, timestamp, from, userId, uuid, message, ...rest }) => {
    const context = rest[SPLAT] || []
    const logPayload = { uuid, message }
    const fromString = from ? ` (FROM ${from} ${userId || ''})` : ''

    const stringifiedConext = `[${context
      .map(item => {
        const isException = isError(item)
        let value = item

        try {
          if (isException) {
            value = errorSerializer(item)
          }

          return JSON.stringify(value)
        } catch {
          let type = upperFirst(typeof item)

          if (isException) {
            type = item.name
          } else if (isArray(item)) {
            type = 'Array'
          }

          return `<${type}>`
        }
      })
      .join(',')}]`

    const stringifiedPayload = JSON.stringify(logPayload).replace(/\}$/, `,"context":${stringifiedConext}}`)
    const logMessage = `${timestamp} - workerId:${global.workerId} - ${level}${fromString}: ${stringifiedPayload}`

    return colorizer.colorize(level, logMessage)
  })

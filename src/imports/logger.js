import winston from 'winston'

const { format } = winston
const { combine, json, prettyPrint } = format

//
// Configure the logger for `category1`
//
winston.loggers.add('default', {
  format: combine(json()),
  level: 'debug',
  transports: [
    new winston.transports.Console({ level: 'debug' })
    // new winston.transports.File({ filename: 'somefile.log' })
  ]
})
const logger = winston.loggers.get('default')
export default logger

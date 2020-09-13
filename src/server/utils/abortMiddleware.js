const NAME = '__$isEnded$' // @todo consider making non-enumerable?

const middleware = (req, res, next) => {
  if (NAME in req.connection) {
    return next()
  }

  Object.defineProperty(req.connection, NAME, {
    writable: true,
    enumerable: false
  })
  req.on('close', () => {
    console.log('AAAAAAAAA connection closed')
    req.connection[NAME] = true
  })

  req.checkConnection = () => {
    if (req.connection[NAME]) {
      throw new Error('Connection already ended.')
    }
  }

  return next()
}

const createMiddleware = () => middleware

export default createMiddleware

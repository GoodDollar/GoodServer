import conf from '../server.config'

export const setUserChainIdMiddleware = () => (req, res, next) => {
  const { user, body } = req
  const { chainId, ...payload } = body || {}

  req.body = payload
  user.chainId = chainId || conf.defaultWhitelistChainId
  next()
}

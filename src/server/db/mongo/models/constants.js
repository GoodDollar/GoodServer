import config from '../../../server.config'
export const MODEL_USER_PRIVATE = 'userprivate_' + (process.env.APP_NAME || config.network)
export const MODEL_WALLET_NONCE = 'walletnonce'
export const MODEL_PROPERTIES = 'server_properties'

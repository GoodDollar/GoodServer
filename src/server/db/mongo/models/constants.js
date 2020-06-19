import config from '../../../server.config'

const envId = process.env.APP_NAME || config.network

export const MODEL_USER_PRIVATE = `userprivate_${envId}`
export const MODEL_DELAYED_TASK = 'delayedtask'
export const MODEL_WALLET_NONCE = 'walletnonce'
export const MODEL_PROPERTIES = `server_properties_${envId}`

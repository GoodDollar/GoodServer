import fetch from 'cross-fetch'
import Config from '../server/server.config'
import logger from '../imports/logger'

const log = logger.child({ from: 'slack' })

export const sendSlackAlert = async json => {
  if (!Config.slackAlertsWebhook) return

  const { env, version, network } = Config
  const text = JSON.stringify({ text: JSON.stringify({ ...json, env, version, network }) })

  try {
    const res = await fetch(Config.slackAlertsWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*'
      },
      body: text
    })

    log.info('slack alert sent:', { res: await res.text(), json })
  } catch (error) {
    log.warn('failed sending slack alert:', error.message, error, { json })
  }
}

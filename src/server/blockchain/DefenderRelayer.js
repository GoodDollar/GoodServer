// @flow
import Config from '../server.config'
import { Relayer } from '@openzeppelin/defender-relay-client'

let instance: Relayer = null
export class DefenderRelayer {
  relayer: Relayer

  constructor(apiKey: string, apiSecret: stirng) {
    if (apiKey && apiSecret) {
      this.relayer = new Relayer({ apiKey, apiSecret })
    }
  }

  static getInstance() {
    if (!instance) {
      instance = new DefenderRelayer(Config.defenderApiKey, Config.defenderApiSecret)
    }

    return instance
  }

  async signMessage(message: string) {
    return this.relayer.sign({ message })
  }
}

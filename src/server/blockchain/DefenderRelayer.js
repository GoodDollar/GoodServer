// @flow
import { Relayer } from '@openzeppelin/defender-relay-client'
import { keccak256 } from 'web3-utils'
import Config from '../server.config'

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
    return this.relayer.sign({ message: keccak256(message) })
  }
}

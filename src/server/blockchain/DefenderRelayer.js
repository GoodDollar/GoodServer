// @flow
import { Relayer, RelayerTransactionPayload } from '@openzeppelin/defender-relay-client'
// import { AutotaskClient } from '@openzeppelin/defender-autotask-client'
import { keccak256 } from 'web3-utils'
import Config from '../server.config'

let instance: Relayer = null
export class DefenderRelayer {
  relayer: Relayer
  autotask: AutotaskClient

  constructor(apiKey: string, apiSecret: stirng) {
    if (apiKey && apiSecret) {
      this.relayer = new Relayer({ apiKey, apiSecret })
      // this.autotask = new AutotaskClient({ apiKey, apiSecret })
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

  async sendTx(payload: RelayerTransactionPayload) {
    return this.relayer.sendTransaction(payload)
  }

  // async triggerTask(taskId: string, data) {
  //   return this.autotask.runAutotask(taskId, data)
  // }
}

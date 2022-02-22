import AdminWallet from '../AdminWallet'
/* eslint-disable-next-line */
import stakingModelTasks from '../stakingModelTasks'
import delay from 'delay'
import { get } from 'lodash'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.min.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'

let fundManager = stakingModelTasks.fundManager

const nextBlock = () =>
  new Promise((res, rej) =>
    AdminWallet.web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_mine',
        params: [],
        id: new Date().getTime()
      },
      (err, result) => (err ? rej(err) : res(result))
    )
  )

const next_interval = async function(interval = 5760) {
  let blocks = interval
  let ps = []
  for (let i = 0; i < blocks; ++i) {
    ps.push(nextBlock())
    if (i % 100 === 0) {
      console.log('evm_mine', i)
      await delay(1000)
    }
  }
  return Promise.all(ps)
}

describe('stakingModelManager', () => {
  beforeAll(async () => {
    await AdminWallet.ready
    //in test mode the bridge simply mock by transfering the mainnet token
    AdminWallet.tokenContract = new AdminWallet.web3.eth.Contract(
      GoodDollarABI.abi,
      get(ContractsAddress, `${AdminWallet.network}-mainnet.GoodDollar`),
      { from: AdminWallet.address }
    )
  })

  //run this first so next tests dont fail
  test(`stakingModelManager should mock interest`, async () => {
    await next_interval(101)
    const gains = await fundManager.getAvailableInterest()
    await fundManager.mockInterest()
    const gains2 = await fundManager.getAvailableInterest()
    expect(parseInt(gains2[0])).toBeGreaterThan(parseInt(gains[0]))
  })

  test(`stakingModelManager should know when to run`, async () => {
    const canRun = await fundManager.canCollectFunds()
    expect(canRun).toBeTruthy()
  })

  let transferBlock, ubiAmount
  test(`stakingModelManager should succeed to transfer interest`, async () => {
    const event = await fundManager.transferInterest()
    transferBlock = event.blockNumber
    ubiAmount = parseInt(event.returnValues.gdUBI)
    expect(ubiAmount).toBeGreaterThan(0)
  })

  test(`stakingModelManager should know he cant run after previous test collecting interest`, async () => {
    const canRun = await fundManager.canCollectFunds()
    expect(canRun).toBeFalsy()
  })

  test(`stakingModelManager should wait for bridge transfer event`, async () => {
    const ubiRecipient = await fundManager.nameService.methods.getAddress('UBI_RECIPIENT').call()
    const bridgeLog = await fundManager.waitForBridgeTransfer(transferBlock, Date.now())
    expect(bridgeLog).toMatchObject({ returnValues: { from: expect.any(String), to: ubiRecipient } })
    expect(parseInt(bridgeLog.returnValues.value)).toEqual(ubiAmount)
  })

  test(`stakingModelManager should return next cronTime`, async () => {
    const { cronTime } = await fundManager.run().catch(_ => _)
    expect(cronTime.isAfter()).toBeTruthy()
  })

  test(`stakingModelManager should fail to transfer interest if no interest to collect`, async () => {
    await expect(fundManager.transferInterest()).resolves.toBe(undefined)
  })
})

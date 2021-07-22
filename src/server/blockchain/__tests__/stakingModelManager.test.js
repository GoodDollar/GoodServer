import AdminWallet from '../AdminWallet'
import { fundManager } from '../stakingModelTasks'
import delay from 'delay'
import { version } from '@gooddollar/goodcontracts/package.json'

const next_interval = async function(interval = 5760) {
  let blocks = interval
  let ps = []
  for (let i = 0; i < blocks; ++i) {
    ps.push(AdminWallet.web3.currentProvider.send('evm_mine'))
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
  })

  //run this first so next tests dont fail
  test(`stakingModelManager should mock interest`, async () => {
    await next_interval(101)
    const gains = await fundManager.getAvailableInterest()
    await fundManager.mockInterest()
    const gains2 = await fundManager.getAvailableInterest()
    expect(gains2[0].toNumber()).toBeGreaterThan(gains[0].toNumber())
  })

  test(`stakingModelManager should know when to run`, async () => {
    const canRun = await fundManager.canCollectFunds()
    expect(canRun).toBeTruthy()
  })

  test(`stakingModelManager should see positive interest gains`, async () => {
    const gains = await fundManager.getAvailableInterest()
    expect(gains[0].toNumber()).toBeGreaterThan(0)
  })

  let transferBlock, ubiAmount
  test(`stakingModelManager should succeed to transfer interest`, async () => {
    const event = await fundManager.transferInterest()
    transferBlock = event.blockNumber
    ubiAmount = event.returnValues.gdUBI.toNumber()
    expect(event.returnValues).toBeTruthy()
    expect(event.returnValues.gdUBI.toNumber()).toBeGreaterThan(0)
  })

  test(`stakingModelManager should know he cant run after previous test collecting interest`, async () => {
    const canRun = await fundManager.canCollectFunds()
    expect(canRun).toBeFalsy()
  })

  test(`stakingModelManager should wait for bridge transfer event`, async () => {
    const ubiRecipient = await fundManager.nameService.methods.getAddress('UBI_RECIPIENT').call()
    const bridgeLog = await fundManager.waitForBridgeTransfer(transferBlock, Date.now())
    expect(bridgeLog).toMatchObject({ returnValues: { from: expect.any(String), to: ubiRecipient } })
    expect(bridgeLog.returnValues.value.toNumber()).toEqual(ubiAmount)
  })

  test(`stakingModelManager should fail to transfer interest if no interest to collect`, async () => {
    expect(fundManager.transferInterest()).rejects.toThrow()
  })

  test(`stakingModelManager should return next cronTime`, async () => {
    const { cronTime } = await fundManager.run().catch(_ => _)
    expect(cronTime.isAfter()).toBeTruthy()
  })
})

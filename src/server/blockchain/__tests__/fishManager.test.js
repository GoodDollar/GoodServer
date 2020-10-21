import AdminWallet from '../AdminWallet'
import { fishManager } from '../stakingModelTasks'
import { version } from '@gooddollar/goodcontracts/package.json'

jest.setTimeout(20000)

const setNextDay = async () => {
  await AdminWallet.web3.currentProvider.send('evm_increaseTime', 60 * 60 * 24).catch(e => console.log(e))
  await AdminWallet.web3.currentProvider.send('evm_mine').catch(e => console.log(e))
}

describe('fishManager', () => {
  if (version < '2.0.0') {
    test(`${version} skiping until v2.0.0`, () => {})
    return
  }
  beforeAll(async () => {
    await AdminWallet.ready
  })

  test(`fishManager get next day should be in the future (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const nextDay = await fishManager.getNextDay()
    expect(nextDay.isAfter()).toBeTruthy()
    await setNextDay()
    const nextDay2 = await fishManager.getNextDay()
    expect(nextDay2.diff(nextDay, 'hours')).toEqual(24)
  })

  test(`fishManager should find UBICalculated days (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const { searchStartDay, searchEndDay, maxInactiveDays } = await fishManager.getUBICalculatedDays()
    expect(maxInactiveDays).toBeGreaterThan(0)
    expect(searchStartDay.returnValues.blockNumber.toNumber()).toBeGreaterThan(0)
    expect(searchEndDay.returnValues.blockNumber.toNumber()).toBeGreaterThan(
      searchStartDay.returnValues.blockNumber.toNumber()
    )
    expect(searchStartDay.returnValues.day.toNumber()).toBeGreaterThan(0)
    expect(searchEndDay.returnValues.day.toNumber()).toEqual(searchStartDay.returnValues.day.toNumber() + 1)
  })

  test(`fishManager should find inactive accounts in interval (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const inactiveAcounts = await fishManager.getInactiveAccounts()
    expect(inactiveAcounts.length).toEqual(10)
    expect(inactiveAcounts[0].length).toEqual(42) //eth address length
  })

  test(`fishManager should fish account and return next run time (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const { result, cronTime, fishers } = await fishManager.run()
    expect(result).toBeTruthy() //success
    expect(cronTime.isAfter()).toBeTruthy() //crontime in future
    expect(fishers.length).not.toEqual(0) //return the fisher admin account
    const balances = await Promise.all(
      fishers.map(f =>
        AdminWallet.tokenContract.methods
          .balanceOf(f)
          .call()
          .then(_ => _.toNumber())
      )
    )
    const dailyUbi = await fishManager.ubiContract.methods.dailyUbi.call().then(_ => _.toNumber())
    balances.forEach(b => expect(b).toBeGreaterThanOrEqual(dailyUbi)) //fisher balance should have the daily claim
  })
})

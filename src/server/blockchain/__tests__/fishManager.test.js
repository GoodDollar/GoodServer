import AdminWallet from '../AdminWallet'
/* eslint-disable-next-line */
import { fishManager } from '../stakingModelTasks'

const setNextDay = async () => {
  await AdminWallet.web3.currentProvider.send('evm_increaseTime', [60 * 60 * 24]).catch(e => console.log(e))
  await AdminWallet.web3.currentProvider.send('evm_mine').catch(e => console.log(e))
}

describe('fishManager', () => {
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
    console.log({ searchStartDay, searchEndDay, maxInactiveDays })
    expect(maxInactiveDays).toBeGreaterThan(0)
    expect(searchStartDay.returnValues.blockNumber.toNumber()).toBeGreaterThan(0)
    expect(searchEndDay.returnValues.blockNumber.toNumber()).toBeGreaterThan(
      searchStartDay.returnValues.blockNumber.toNumber()
    )
    expect(searchStartDay.returnValues.day.toNumber())
    expect(searchEndDay.returnValues.day.toNumber()).toBeGreaterThan(searchStartDay.returnValues.day.toNumber())
  })

  test(`fishManager should find inactive accounts in interval (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const inactiveAcounts = await fishManager.getInactiveAccounts()
    expect(inactiveAcounts.length).toBeGreaterThan(0)
    expect(inactiveAcounts[0].length).toEqual(42) //eth address length
  })

  test(`fishManager should fish account and return next run time (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    await setNextDay()
    await AdminWallet.sendTransaction(AdminWallet.UBIContract.methods.claim())
    let gdbalanceBefore = await AdminWallet.tokenContract.methods.balanceOf(fishManager.ubiContract.address).call()
    const { result, cronTime, fishers } = await fishManager.run()
    expect(result).toBeTruthy() //success
    expect(cronTime.isAfter()).toBeTruthy() //crontime in future
    expect(fishers.length).not.toEqual(0) //return the fisher admin account
    let gdbalanceAfter = await AdminWallet.tokenContract.methods.balanceOf(fishManager.ubiContract.address).call()

    //we transfer all fished bonus funds back to UBI, so balances before and after should be equal
    expect(gdbalanceAfter.toNumber()).toEqual(gdbalanceBefore.toNumber())
  })
})

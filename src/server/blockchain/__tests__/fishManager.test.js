import AdminWallet from '../AdminWallet'
/* eslint-disable-next-line */
import stakingModelTasks from '../stakingModelTasks'

let fishManager = stakingModelTasks.fishManager

const setNextDay = async () => {
  await new Promise((res, rej) =>
    AdminWallet.web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [60 * 60 * 24],
        id: new Date().getTime()
      },
      (err, result) => (err ? rej(err) : res(result))
    )
  )

  await new Promise((res, rej) =>
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
    expect(maxInactiveDays).toBeGreaterThan(0)
    expect(parseInt(searchStartDay.returnValues.blockNumber)).toBeGreaterThan(0)
    expect(parseInt(searchEndDay.returnValues.blockNumber)).toBeGreaterThan(
      parseInt(searchStartDay.returnValues.blockNumber)
    )
    expect(parseInt(searchEndDay.returnValues.day)).toBeGreaterThan(parseInt(searchStartDay.returnValues.day))
  })

  test(`fishManager should find inactive accounts in interval (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const inactiveAcounts = await fishManager.getInactiveAccounts()
    expect(inactiveAcounts.length).toBeGreaterThan(0)
    expect(inactiveAcounts[0].length).toEqual(42) //eth address length
  })

  test(`fishManager should fish account and return next run time (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    await setNextDay()
    await setNextDay()
    await AdminWallet.sendTransaction(AdminWallet.UBIContract.methods.claim())
    let gdbalanceBefore = await AdminWallet.tokenContract.methods
      .balanceOf(fishManager.ubiContract._address)
      .call()
      .then(parseInt)
    const { result, cronTime, fishers } = await fishManager.run()
    expect(result).toBeTruthy() //success
    expect(cronTime.isAfter()).toBeTruthy() //crontime in future
    expect(fishers.length).not.toEqual(0) //return the fisher admin account
    let gdbalanceAfter = await AdminWallet.tokenContract.methods
      .balanceOf(fishManager.ubiContract._address)
      .call()
      .then(parseInt)

    //we transfer all fished bonus funds back to UBI, so balances before and after should be equal
    expect(gdbalanceAfter).toEqual(gdbalanceBefore)
  })
})

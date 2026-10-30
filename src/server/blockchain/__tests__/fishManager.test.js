import moment from 'moment'
import AdminWallet from '../AdminWallet'
/* eslint-disable-next-line */
import stakingModelTasks from '../stakingModelTasks'

let fishManager = stakingModelTasks.fishManager

const setNextDay = async () => {
  await AdminWallet.publicClient.request({ method: 'evm_increaseTime', params: [60 * 60 * 24] })
  await AdminWallet.publicClient.request({ method: 'evm_mine', params: [] })
}

describe.skip('fishManager', () => {
  beforeAll(async () => {
    await AdminWallet.ready
  })

  test(`fishManager get next day should be in the future (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const blockchainNow = await AdminWallet.publicClient
      .getBlock({ blockTag: 'latest' })
      .then(_ => moment(Number(_.timestamp) * 1000).startOf('hour'))

    const nextDay = await fishManager.getNextDay()
    expect(nextDay.isAfter(blockchainNow)).toBeTruthy()
    await setNextDay()
    const nextDay2 = await fishManager.getNextDay()
    expect(nextDay2.diff(nextDay, 'hours')).toEqual(24)
  })

  test(`fishManager should find UBICalculated days (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const { searchStartDay, searchEndDay, maxInactiveDays } = await fishManager.getUBICalculatedDays()
    expect(maxInactiveDays).toBeGreaterThan(0)
    expect(parseInt(searchStartDay.args.blockNumber)).toBeGreaterThan(0)
    expect(parseInt(searchEndDay.args.blockNumber)).toBeGreaterThan(parseInt(searchStartDay.args.blockNumber))
    expect(parseInt(searchEndDay.args.day)).toBeGreaterThan(parseInt(searchStartDay.args.day))
  })

  test(`fishManager should find inactive accounts in interval (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const inactiveAcounts = await fishManager.getInactiveAccounts()
    expect(inactiveAcounts.length).toBeGreaterThan(0)
    expect(inactiveAcounts[0].length).toEqual(42) //eth address length
  })

  test(`fishManager should fish account and return next run time (need to run script simulateInterestDays.js in goodcontracts)`, async () => {
    const blockchainNow = await AdminWallet.publicClient
      .getBlock({ blockTag: 'latest' })
      .then(_ => moment(Number(_.timestamp) * 1000).startOf('hour'))
    await setNextDay()
    await setNextDay()
    await AdminWallet.sendTransaction(AdminWallet.contractTransaction(AdminWallet.UBIContract, 'claim', []))
    let gdbalanceBefore = await AdminWallet.tokenContract.read
      .balanceOf([fishManager.ubiContract.address])
      .then(parseInt)
    const { result, cronTime, fishers } = await fishManager.run()
    expect(result).toBeTruthy() //success
    expect(cronTime.isAfter(blockchainNow)).toBeTruthy() //crontime in future
    expect(fishers.length).not.toEqual(0) //return the fisher admin account
    let gdbalanceAfter = await AdminWallet.tokenContract.read
      .balanceOf([fishManager.ubiContract.address])
      .then(parseInt)

    //we transfer all fished bonus funds back to UBI, so balances before and after should be equal
    expect(gdbalanceAfter).toEqual(gdbalanceBefore)
  })
})

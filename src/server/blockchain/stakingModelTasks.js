import FundManagerABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/GoodFundManager.min.json'
import StakingABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.min.json'
import UBISchemeABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/UBIScheme.min.json'
import DaiABI from '@gooddollar/goodcontracts/build/contracts/DAIMock.min.json'
import cDaiABI from '@gooddollar/goodcontracts/build/contracts/cDAIMock.min.json'
import ContractsAddress from '@gooddollar/goodcontracts/stakingModel/releases/deployment.json'
import fetch from 'cross-fetch'
import AdminWallet from './AdminWallet'
import { get, chunk, result } from 'lodash'
import logger from '../../imports/logger'
import delay from 'delay'
import moment from 'moment'
import { toWei } from 'web3-utils'
import config from '../server.config'
import { sendSlackAlert } from '../../imports/slack'
const BRIDGE_TRANSFER_TIMEOUT = 60 * 1000 * 5 //5 min
const FUSE_DAY_BLOCKS = (60 * 60 * 24) / 5
/**
 * a manager to make sure we collect and transfer the interest from the staking contract
 */
export class StakingModelManager {
  lastRopstenTopping = moment()
  addresses = get(ContractsAddress, `${AdminWallet.network}-mainnet`) || get(ContractsAddress, `${AdminWallet.network}`)
  managerAddress = this.addresses['FundManager']
  stakingAddress = this.addresses['DAIStaking']
  daiAddress = this.addresses['DAI']
  cDaiAddress = this.addresses['cDAI']

  constructor() {
    this.log = logger.child({ from: 'StakingModelManager' })
    this.managerContract = AdminWallet.mainnetWeb3.eth.Contract(FundManagerABI.abi, this.managerAddress)
    this.stakingContract = AdminWallet.mainnetWeb3.eth.Contract(StakingABI.abi, this.stakingAddress)
    this.dai = AdminWallet.mainnetWeb3.eth.Contract(DaiABI.abi, this.daiAddress)
    this.cDai = AdminWallet.mainnetWeb3.eth.Contract(cDaiABI.abi, this.cDaiAddress)
    this.managerContract.methods.bridgeContract.call().then(_ => (this.bridge = _))
    this.managerContract.methods.ubiRecipient.call().then(_ => (this.ubiScheme = _))
  }

  canCollectFunds = async () => this.managerContract.methods.canRun.call()

  blocksUntilNextCollection = async () => {
    const interval = await this.managerContract.methods.blockInterval.call().then(parseInt)
    const lastTransferred = await this.managerContract.methods.lastTransferred.call().then(parseInt)
    const currentBlock = await AdminWallet.mainnetWeb3.eth.getBlockNumber()
    const res = interval - ((currentBlock - lastTransferred * interval) % interval)
    return res
  }

  getAvailableInterest = async () => this.stakingContract.methods.currentUBIInterest.call()
  transferInterest = async () => {
    const fundsTX = await AdminWallet.sendTransactionMainnet(
      this.managerContract.methods.transferInterest(this.stakingAddress),
      {}
    )
    const fundsEvent = get(fundsTX, 'events.FundsTransferred')
    this.log.info('transferInterest result event', { fundsEvent })
    return fundsEvent
  }

  getNextCollectionTime = async () => {
    let canCollectFunds = await this.canCollectFunds()
    if (canCollectFunds === false) {
      const blocksForNextCollection = await this.blocksUntilNextCollection()
      this.log.info('canRun result:', { canCollectFunds, blocksForNextCollection })
      return moment().add(blocksForNextCollection * 15, 'seconds')
    }
    return moment()
  }

  mockInterest = async () => {
    if (config.ethereumMainnet.network_id !== 1) {
      //top ropsten wallet
      if (moment().diff(this.lastRopstenTopping, 'days') > 0) {
        fetch('https://faucet.metamask.io', { method: 'POST', body: AdminWallet.mainnetAddresses[0] }).catch(e => {
          this.log.error('failed calling ropsten faucet', e)
        })
        this.lastRopstenTopping = moment()
      }
      const tx1 = AdminWallet.sendTransactionMainnet(
        this.dai.methods.approve(this.cDai.address, toWei('100', 'ether')),
        {},
        {},
        AdminWallet.mainnetAddresses[0]
      )
      const tx2 = AdminWallet.sendTransactionMainnet(
        this.dai.methods.allocateTo(AdminWallet.mainnetAddresses[0], toWei('100', 'ether')),
        {},
        {}
      )
      await Promise.all([tx1, tx2]).catch(e => {
        this.log.warn('mockInterest dai approve and allocateTo failed', { e, msg: e.message })
        throw e
      })
      this.log.info('mockInterest approved and allocated dai. minting cDai...')
      const tx3 = await AdminWallet.sendTransactionMainnet(
        this.cDai.methods.mint(toWei('100', 'ether')),
        {},
        {},
        AdminWallet.mainnetAddresses[0]
      )

      let ownercDaiBalanceAfter = await this.cDai.methods
        .balanceOf(AdminWallet.mainnetAddresses[0])
        .call()
        .then(_ => _.toString())

      this.log.info('mockInterest minted fake cDai, transferring to staking contract...', { ownercDaiBalanceAfter })
      await AdminWallet.sendTransactionMainnet(
        this.cDai.methods.transfer(this.stakingAddress, ownercDaiBalanceAfter),
        {},
        {},
        AdminWallet.mainnetAddresses[0]
      )
    }
  }
  run = async () => {
    try {
      const nextCollectionTime = await this.getNextCollectionTime()
      if (nextCollectionTime.isAfter()) {
        this.log.info('waiting for collect interest time', { nextCollectionTime })
        return { result: 'waiting', cronTime: nextCollectionTime }
      }
      const availableInterest = await this.getAvailableInterest()
      this.log.info('starting collect interest', {
        availableInterest,
        nextCollectionTime: nextCollectionTime.toString()
      })
      await this.mockInterest().catch(e => {
        this.log.warn('mockInterest failed, continuing...')
        sendSlackAlert({ msg: 'failure: mockInterest failed', error: e.message })
      })
      const fundsEvent = await this.transferInterest().catch(e => {
        this.log.warn('transferInterest failed. stopping.')
        sendSlackAlert({ msg: 'failure: transferInterest failed', error: e.message })
        throw e
      })
      const sidechainCurBlock = await AdminWallet.web3.eth.getBlockNumber()

      if (fundsEvent === undefined) {
        const cronTime = await this.getNextCollectionTime()
        this.log.warn('No transfered funds event found. (interest was 0?)', { cronTime })
        sendSlackAlert({ msg: 'warning: no transfer funds event found' })
        return { result: 'no interest', cronTime }
      }
      const ubiTransfered = fundsEvent.returnValues.gdUBI.toString()
      if (ubiTransfered === '0') {
        this.log.warn('No UBI was transfered to bridge')
      } else {
        this.log.info('ubi interest collected. waiting for bridge...', { gdUBI: ubiTransfered })
        //wait for funds on sidechain to transfer via bridge
        const transferEvent = await this.waitForBridgeTransfer(sidechainCurBlock, Date.now(), ubiTransfered)
        this.log.info('ubi success: bridge transfer event found', {
          ubiGenerated: transferEvent.returnValues.value.toString()
        })
      }
      sendSlackAlert({ msg: 'success: UBI transfered', ubiTransfered })

      const cronTime = await this.getNextCollectionTime()
      this.log.info('next run:', { cronTime })
      return { result: true, cronTime }
    } catch (e) {
      const cronTime = await this.getNextCollectionTime()
      //make sure atleast one hour passes in case of an error
      if (cronTime.isBefore(moment().add(1, 'hour'))) cronTime.add(1, 'hour')
      this.log.error('collecting interest failed.', { e, errMsg: e.message, cronTime })
      sendSlackAlert({ msg: 'failure: collecting interest failed.', error: e.message })

      return { result: false, cronTime }
    }
  }

  /**
   * wait for  bridge on sidechain to transfer the tokens from mainnet
   *
   * @param {*} fromBlock starting block listen to events
   * @param {*} bridge the sender of the tokens
   * @param {*} ubiScheme the recipient
   * @param {*} start used to calculate timeout
   */
  waitForBridgeTransfer = async (fromBlock, start, value) => {
    const res = await AdminWallet.tokenContract.getPastEvents('Transfer', {
      fromBlock,
      filter: {
        to: this.ubiScheme,
        value
      }
    })
    this.log.info('waitforBirgdeTransfer events:', {
      fromBlock,
      start,
      res,
      bridge: this.homeBridge,
      ubi: this.ubiScheme
    })
    if (res && res.length > 0) {
      return res[0]
    }
    if (Date.now() - start > BRIDGE_TRANSFER_TIMEOUT) {
      throw new Error('waiting for bridge transfer timed out')
    }
    //wait 5 sec for retry
    await delay(5000)
    return this.waitForBridgeTransfer(fromBlock, start, value)
  }
}

const fundManager = new StakingModelManager()

/**
 * a manager to make sure we fish inactive users
 */
class FishingManager {
  ubiScheme = get(ContractsAddress, `${AdminWallet.network}.UBIScheme`)

  constructor() {
    this.log = logger.child({ from: 'FishingManager' })
    this.ubiContract = AdminWallet.web3.eth.Contract(UBISchemeABI.abi, this.ubiScheme)
  }

  /**
   * calculate the next claim epoch
   */
  getNextDay = async () => {
    const startRef = await this.ubiContract.methods.periodStart
      .call()
      .then(_ => moment(_.toNumber() * 1000).startOf('hour'))
    const blockchainNow = await AdminWallet.web3.eth
      .getBlock('latest')
      .then(_ => moment(_.timestamp * 1000).startOf('hour'))
    const hoursDiff = blockchainNow.diff(startRef, 'hours')
    const hoursUntil = 24 - (hoursDiff % 24)
    this.log.info('fishManager getNextDay', { startRef, blockchainNow, hoursUntil })
    return blockchainNow.add(hoursUntil, 'hours')
  }

  /**
   * read events of previous claim epochs
   * we get the start block and end block for searching for possible inactive users
   */
  getUBICalculatedDays = async () => {
    const dayFuseBlocks = (60 * 60 * 24) / 5
    const maxInactiveDays = await this.ubiContract.methods.maxInactiveDays.call().then(_ => _.toNumber())

    const daysagoBlocks = dayFuseBlocks * (maxInactiveDays + 1)
    const blocksAgo = Math.max((await AdminWallet.web3.eth.getBlockNumber()) - daysagoBlocks, 0)
    await AdminWallet.sendTransaction(this.ubiContract.methods.setDay(), {}).catch(e =>
      this.log.warn('fishManager set day failed')
    )
    const currentUBIDay = await this.ubiContract.methods.currentDay.call().then(_ => _.toNumber())
    this.log.info('getInactiveAccounts', { daysagoBlocks, blocksAgo, currentUBIDay, maxInactiveDays })
    //get claims that were done before inactive period days ago, these accounts has the potential to be inactive
    //first we get the starting block
    const ubiEvents = await this.ubiContract.getPastEvents('UBICalculated', { fromBlock: blocksAgo }).catch(e => {
      this.log.warn('fishManager getPastEvents failed')
      throw e
    })
    this.log.info('getUBICalculatedDays ubiEvents:', { ubiEvents })
    const searchStartDay = ubiEvents.find(e => e.returnValues.day.toNumber() === currentUBIDay - maxInactiveDays)
    const searchEndDay = ubiEvents.find(e => e.returnValues.day.toNumber() === currentUBIDay - maxInactiveDays + 1)
    this.log.info('getInactiveAccounts got UBICalculatedEvents:', {
      foundEvents: ubiEvents.length,
      startDay: searchStartDay && searchStartDay.returnValues.day.toNumber(),
      endDay: searchEndDay && searchEndDay.returnValues.day.toNumber(),
      searchStartDay: searchStartDay,
      searchEndDay: searchEndDay
    })
    return { searchStartDay, searchEndDay, maxInactiveDays }
  }

  /**
   * users that claimed 14 days(or maxInactiveDays) ago are possible candidates to be inactive
   */
  getInactiveAccounts = async () => {
    const { searchStartDay, searchEndDay, maxInactiveDays } = await this.getUBICalculatedDays()

    if (searchStartDay === undefined) {
      this.log.warn('No UBICalculated event found for inactive interval', { maxInactiveDays })
    }
    //now get accounts that claimed in that day
    const claimBlockStart = result(
      searchStartDay,
      'returnValues.blockNumber.toNumber',
      (await AdminWallet.web3.eth.getBlockNumber()) - maxInactiveDays * FUSE_DAY_BLOCKS
    )

    const claimBlockEnd = result(searchEndDay, 'returnValues.blockNumber.toNumber', claimBlockStart + FUSE_DAY_BLOCKS)

    //get candidates
    const claimEvents = await this.ubiContract.getPastEvents('UBIClaimed', {
      fromBlock: claimBlockStart,
      toBlock: claimBlockEnd
    })

    //check if they are inactive
    const inactiveAccounts = (await Promise.all(
      claimEvents.map(async e => {
        const isActive = await this.ubiContract.methods.isActiveUser(e.returnValues.claimer).call()
        return isActive ? undefined : e.returnValues.claimer
      })
    )).filter(_ => _)

    this.log.info('getInactiveAccounts found UBIClaimed events', {
      totalEvents: claimEvents.length,
      inactiveFound: inactiveAccounts.length
    })
    return inactiveAccounts
  }

  /**
   * perform the fishMulti TX on the ubiContract
   */
  fishChunk = async tofish => {
    const fishTX = await AdminWallet.sendTransaction(this.ubiContract.methods.fishMulti(tofish), {}, { gas: 6000000 })
    const fishEvent = get(fishTX, 'events.TotalFished')
    const totalFished = fishEvent.returnValues.total.toNumber()
    this.log.info('Fished accounts', { tofish, totalFished, fisherAccount: fishTX.from, fishEvents: fishTX.events })
    return { totalFished, fisherAccount: fishTX.from }
  }

  /**
   * split fishing into multiple chunks
   */
  fish = async (accounts, fishers = []) => {
    let unfished = []
    let failed = 0
    for (let tofish of chunk(accounts, 50)) {
      try {
        this.log.info('calling fishChunk', { tofish })
        const { totalFished, fisherAccount } = await this.fishChunk(tofish)
        unfished = unfished.concat(tofish.slice(totalFished))
        fishers.push(fisherAccount)
      } catch (e) {
        failed += tofish.length
        this.log.error('Failed fishing chunk', { tofish, error: e.message, e })
      }
    }
    sendSlackAlert({ msg: 'info: fishing done', unfished: unfished.length, failed, outof: accounts.length })

    if (unfished.length > 0) {
      this.log.info('Retrying unfished accounts', { unfished: unfished.length })
      return await this.fish(unfished, fishers)
    }
    return fishers
  }

  run = async () => {
    try {
      const inactive = await this.getInactiveAccounts()
      const fishers = await this.fish(inactive)
      const cronTime = await this.getNextDay()
      return { result: true, cronTime, fishers }
    } catch (e) {
      this.log.error('fishing task failed:', { e, errMsg: e.message })
      sendSlackAlert({ msg: 'failure: fishing failed', error: e.message })

      const cronTime = await this.getNextDay()
      if (cronTime.isBefore(moment().add(1, 'hour'))) cronTime.add(1, 'hour')
      return { result: true, cronTime }
    }
  }
}

const fishManager = new FishingManager()

class StakingModelTask {
  // using context allowing us to manipulate task execution
  // it's more clear that return some values.
  // also, delayed task pattern doesn't generally includes that task should return something
  // the task could pass or fail that's all. async function contract allows us to implement those statuses
  async execute({ setTime }) {
    const { cronTime } = await this.run()

    if (cronTime) {
      // According to the docs, setTime accepts CronTime only
      // CronTime constructor accepts cron string or JS Date.
      // there's no info about moment object support.
      // probavbly it works due to the .toString or [Symbol.toPrimitive] override
      // but let's better convert moment to the JS date to strictly keep node-cron's contracts
      setTime(cronTime.toDate())
    }
  }

  /**
   * @abstract
   */
  async run() {}
}

class CollectFundsTask extends StakingModelTask {
  get schedule() {
    return config.stakeTaskCron
  }

  get name() {
    return 'StakingModel'
  }

  async run() {
    return fundManager.run()
  }
}

class FishInactiveTask extends StakingModelTask {
  get schedule() {
    return config.fishTaskCron
  }

  get name() {
    return 'FishInactiveUsers'
  }

  async run() {
    return fishManager.run()
  }
}

const collectFundsTask = new CollectFundsTask()
const fishInactiveTask = new FishInactiveTask()
export { collectFundsTask, fishInactiveTask, fundManager, fishManager }

import FundManagerABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/GoodFundManager.min.json'
import StakingABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.min.json'
import UBISchemeABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/UBIScheme.min.json'
import DaiABI from '@gooddollar/goodcontracts/build/contracts/DAIMock.min.json'
import cDaiABI from '@gooddollar/goodcontracts/build/contracts/cDAIMock.min.json'
import ContractsAddress from '@gooddollar/goodcontracts/stakingModel/releases/deployment.json'
import fetch from 'cross-fetch'
import AdminWallet from './AdminWallet'
import { get, chunk, result, range, flatten, once } from 'lodash'
import logger from '../../imports/logger'
import delay from 'delay'
import moment from 'moment'
import { parseEther } from 'viem'
import config from '../server.config'
import { sendSlackAlert } from '../../imports/slack'
import { retry as retryAttempt } from '../utils/async'
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
    this.init()
  }

  init = once(async () => {
    await AdminWallet.ready

    // polling timeout since ethereum has network congestion and we try to pay little gas so it will take a long time to confirm tx
    this.managerContract = AdminWallet.getContract(
      FundManagerABI.abi,
      this.managerAddress,
      AdminWallet.mainnetPublicClient
    )

    this.stakingContract = AdminWallet.getContract(StakingABI.abi, this.stakingAddress, AdminWallet.mainnetPublicClient)
    this.dai = AdminWallet.getContract(DaiABI.abi, this.daiAddress, AdminWallet.mainnetPublicClient)
    this.cDai = AdminWallet.getContract(cDaiABI.abi, this.cDaiAddress, AdminWallet.mainnetPublicClient)
    this.managerContract.read.bridgeContract([]).then(_ => (this.bridge = _))
    this.managerContract.read.ubiRecipient([]).then(_ => (this.ubiScheme = _))
  })

  canCollectFunds = async () => this.managerContract.read.canRun([])

  blocksUntilNextCollection = async () => {
    const interval = await this.managerContract.read.blockInterval([]).then(parseInt)
    const lastTransferred = await this.managerContract.read.lastTransferred([]).then(parseInt)
    const currentBlock = await AdminWallet.mainnetPublicClient.getBlockNumber().then(Number)
    const res = interval - ((currentBlock - lastTransferred * interval) % interval)
    return res
  }

  getAvailableInterest = async () => this.stakingContract.read.currentUBIInterest([]).then(parseInt)
  transferInterest = async () => {
    let txHash
    try {
      const fundsTX = await AdminWallet.sendTransactionMainnet(
        AdminWallet.contractTransaction(this.managerContract, 'transferInterest', [this.stakingAddress]),
        { onTransactionHash: h => (txHash = h) },
        { gas: 700000 }, //force fixed gas price, tx should take around 450k
        AdminWallet.mainnetAddresses[0]
      )
      const fundsEvents = await this.managerContract.getEvents.FundsTransferred(
        {},
        { fromBlock: BigInt(fundsTX.blockNumber), toBlock: BigInt(fundsTX.blockNumber) }
      )
      const fundsEvent = fundsEvents.find(event => event.transactionHash === fundsTX.transactionHash)
      this.log.info('transferInterest result event', { fundsEvent })
      return fundsEvent
    } catch (e) {
      if (txHash && e.message.toLowerCase().includes('timeout')) {
        return this.waitForTransferInterest(txHash)
      } else {
        throw e
      }
    }
  }

  waitForTransferInterest = async txHash => {
    const { log } = this

    return retryAttempt(
      async retry => {
        log.info('retrying timedout tx', { txHash, retry })

        const receipt = await AdminWallet.mainnetPublicClient.getTransactionReceipt({ hash: txHash })

        if (!receipt) {
          throw new Error('No receipt yet, retrying')
        }

        if (receipt.status === 'success') {
          const fundsEvents = await this.managerContract.getEvents.FundsTransferred(
            {},
            { fromBlock: BigInt(receipt.blockNumber), toBlock: BigInt(receipt.blockNumber) }
          )

          const fundsEvent = get(fundsEvents, 0)

          log.info('retrying timedout tx success transferInterest result event', { txHash, fundsEvent })
          return fundsEvent
        }

        // tx eventually failed
        throw new Error('retrying timedout tx failed txHash: ' + txHash)
      },
      -1,
      1000 * 60 * 10,
      e => /no\sreceipt/i.test(get(e, 'message', ''))
    ) // no receipt yet wait 10 minutes
  }

  getNextCollectionTime = async () => {
    let canCollectFunds = await this.canCollectFunds()
    const blocksForNextCollection = await this.blocksUntilNextCollection()
    this.log.info('canRun result:', { canCollectFunds, blocksForNextCollection })
    if (canCollectFunds === false) {
      return moment().add(blocksForNextCollection * 15, 'seconds')
    }
    return moment()
  }

  mockInterest = async () => {
    if (config.ethereumMainnet.network_id === 1) {
      return
    }
    //top ropsten wallet
    if (moment().diff(this.lastRopstenTopping, 'days') > 0) {
      fetch('https://faucet.metamask.io', { method: 'POST', body: AdminWallet.mainnetAddresses[0] }).catch(e => {
        this.log.error('failed calling ropsten faucet', e.message, e)
      })
      this.lastRopstenTopping = moment()
    }
    const tx1 = AdminWallet.sendTransactionMainnet(
      AdminWallet.contractTransaction(this.dai, 'approve', [this.cDai.address, parseEther('10').toString()]),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(e => {
      this.log.warn('dai  approve failed')
      throw e
    })
    const tx2 = AdminWallet.sendTransactionMainnet(
      AdminWallet.contractTransaction(this.dai, 'allocateTo', [
        AdminWallet.mainnetAddresses[0],
        parseEther('100').toString()
      ]),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(() => {
      this.log.warn('dai  allocateTo failed')
    })
    await Promise.all([tx1, tx2]).catch(e => {
      this.log.warn('mockInterest dai approve and allocateTo failed', { e, msg: e.message })
      throw e
    })

    this.log.info('mockInterest approved and allocated dai. minting cDai...')
    await AdminWallet.sendTransactionMainnet(
      AdminWallet.contractTransaction(this.cDai, 'mint', [parseEther('10').toString()]),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    )

    let ownercDaiBalanceAfter = await this.cDai.read.balanceOf([AdminWallet.mainnetAddresses[0]])

    this.log.info('mockInterest minted fake cDai, transferring to staking contract...', { ownercDaiBalanceAfter })
    await AdminWallet.sendTransactionMainnet(
      AdminWallet.contractTransaction(this.cDai, 'transfer', [this.stakingAddress, ownercDaiBalanceAfter]),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    )
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
      const sidechainCurBlock = await AdminWallet.publicClient.getBlockNumber().then(Number)

      if (fundsEvent === undefined) {
        const cronTime = await this.getNextCollectionTime()
        this.log.warn('No transfered funds event found. (interest was 0?)', { cronTime })
        sendSlackAlert({ msg: 'warning: no transfer funds event found' })
        return { result: 'no interest', cronTime }
      }
      const ubiTransfered = fundsEvent.args.gdUBI.toString()
      if (ubiTransfered === '0') {
        this.log.warn('No UBI was transfered to bridge')
      } else {
        this.log.info('ubi interest collected. waiting for bridge...', { gdUBI: ubiTransfered })
        //wait for funds on sidechain to transfer via bridge
        const transferEvent = await this.waitForBridgeTransfer(sidechainCurBlock, Date.now(), ubiTransfered)
        this.log.info('ubi success: bridge transfer event found', {
          ubiGenerated: transferEvent.args.value
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

      const { message } = e
      this.log.error('collecting interest failed.', message, e, { cronTime })
      sendSlackAlert({ msg: 'failure: collecting interest failed.', error: message })

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
    const res = (
      await AdminWallet.tokenContract.getEvents.Transfer({ to: this.ubiScheme }, { fromBlock: BigInt(fromBlock) })
    ).filter(event => value === undefined || event.args.value.toString() === value.toString())
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

export const fundManager = new StakingModelManager()

/**
 * a manager to make sure we fish inactive users
 */
class FishingManager {
  ubiScheme = get(ContractsAddress, `${AdminWallet.network}.UBIScheme`)

  constructor() {
    this.log = logger.child({ from: 'FishingManager' })
    this.init()
  }

  init = once(async () => {
    await AdminWallet.ready

    this.ubiContract = AdminWallet.getContract(UBISchemeABI.abi, this.ubiScheme)
  })

  /**
   * calculate the next claim epoch
   */
  getNextDay = async () => {
    const startRef = await this.ubiContract.read.periodStart([]).then(_ => moment(parseInt(_) * 1000).startOf('hour'))
    const blockchainNow = await AdminWallet.publicClient
      .getBlock({ blockTag: 'latest' })
      .then(_ => moment(Number(_.timestamp) * 1000).startOf('hour'))
    const hoursDiff = blockchainNow.diff(startRef, 'hours')
    const hoursUntil = 24 - (hoursDiff % 24)
    this.log.info('fishManager getNextDay', { startRef, blockchainNow, hoursUntil })
    return blockchainNow.add(hoursUntil, 'hours')
  }

  /**
   * read events of previous claim epochs
   * we get the start block and end block for searching for possible inactive users
   */
  getUBICalculatedDays = async forceDaysAgo => {
    const dayFuseBlocks = (60 * 60 * 24) / 5
    const maxInactiveDays = forceDaysAgo || (await this.ubiContract.read.maxInactiveDays([]).then(parseInt))

    const daysagoBlocks = dayFuseBlocks * (maxInactiveDays + 1)
    const blocksAgo = Math.max((await AdminWallet.publicClient.getBlockNumber().then(Number)) - daysagoBlocks, 0)
    await AdminWallet.sendTransaction(AdminWallet.contractTransaction(this.ubiContract, 'setDay', []), {}).catch(() =>
      this.log.warn('fishManager set day failed')
    )
    const currentUBIDay = await this.ubiContract.read.currentDay([]).then(parseInt)
    this.log.info('getInactiveAccounts', { daysagoBlocks, blocksAgo, currentUBIDay, maxInactiveDays })
    //get claims that were done before inactive period days ago, these accounts has the potential to be inactive
    //first we get the starting block
    const ubiEvents = await this.ubiContract.getEvents.UBICalculated({}, { fromBlock: BigInt(blocksAgo) }).catch(e => {
      this.log.warn('fishManager getPastEvents failed')
      throw e
    })
    this.log.info('getUBICalculatedDays ubiEvents:', {
      ubiEvents: ubiEvents.length,
      ubiEventDays: ubiEvents.map(_ => result(_, 'args.day'))
    })

    //find first day older than maxInactiveDays (ubiEvents is sorted from old to new  so we reverse it)
    const searchStartDay = ubiEvents.reverse().find(e => Number(e.args.day) <= currentUBIDay - maxInactiveDays)

    const startDay = Number(result(searchStartDay, 'args.day', 0))
    //find first day newer than searchStartDay
    const searchEndDay = ubiEvents.reverse().find(e => Number(e.args.day) > startDay)
    const endDay = Number(result(searchEndDay, 'args.day', 0))

    this.log.info('getUBICalculatedDays got UBICalculatedEvents:', {
      currentUBIDay,
      foundEvents: ubiEvents.length,
      startDay,
      endDay
      // searchStartDay: searchStartDay,
      // searchEndDay: searchEndDay,
    })
    return { searchStartDay, searchEndDay, maxInactiveDays }
  }

  /**
   * users that claimed 14 days(or maxInactiveDays) ago are possible candidates to be inactive
   */
  getInactiveAccounts = async forceDaysAgo => {
    const { searchStartDay, searchEndDay, maxInactiveDays } = await this.getUBICalculatedDays(forceDaysAgo)

    if (searchStartDay === undefined) {
      this.log.warn('No UBICalculated event found for inactive interval', { maxInactiveDays })
    }
    //now get accounts that claimed in that day
    const claimBlockStart = Number(
      result(
        searchStartDay,
        'args.blockNumber',
        Math.max((await AdminWallet.publicClient.getBlockNumber().then(Number)) - maxInactiveDays * FUSE_DAY_BLOCKS, 0)
      )
    )

    const claimBlockEnd = Number(result(searchEndDay, 'args.blockNumber', claimBlockStart + FUSE_DAY_BLOCKS))

    //get candidates
    const chunkSize = FUSE_DAY_BLOCKS / 10
    const blockChunks = range(claimBlockStart, claimBlockEnd, chunkSize)
    const claimEvents = flatten(
      await Promise.all(
        blockChunks.map(startBlock =>
          this.ubiContract.getEvents
            .UBIClaimed(
              {},
              { fromBlock: BigInt(startBlock), toBlock: BigInt(Math.min(claimBlockEnd, startBlock + chunkSize)) }
            )
            .catch(e => {
              this.log.warn('getInactiveAccounts getPastEvents UBIClaimed chunk failed', e.message, {
                startBlock,
                chunkSize
              })
              return []
            })
        )
      )
    )

    this.log.info('getInactiveAccounts got UBIClaimed events', {
      claimBlockStart,
      claimBlockEnd,
      total: claimEvents.length
    })
    //check if they are inactive
    let inactiveAccounts = []
    let inactiveCheckFailed = 0
    const checkInactive = async e => {
      const isActive = await this.ubiContract.read.isActiveUser([e.args.claimer]).catch(() => undefined)
      if (isActive === undefined) {
        inactiveCheckFailed += 1
      }
      return isActive ? undefined : e.args.claimer
    }
    for (let eventsChunk of chunk(claimEvents, 100)) {
      const inactive = (await Promise.all(eventsChunk.map(checkInactive))).filter(_ => _)
      this.log.debug('getInactiveAccounts batch:', { inactiveCheckFailed, inactiveFound: inactive.length })
      inactiveAccounts = inactiveAccounts.concat(inactive)
    }

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
    const fishTX = await AdminWallet.fishMulti(tofish, this.log)
    const fishEvents = await AdminWallet.UBIContract.getEvents.TotalFished(
      {},
      { fromBlock: BigInt(fishTX.blockNumber), toBlock: BigInt(fishTX.blockNumber) }
    )
    const fishEvent = fishEvents.find(e => e.transactionHash === fishTX.transactionHash)
    const totalFished = result(fishEvent, 'args.total', 0)
    this.log.info('Fished accounts', { tofish, totalFished, fisherAccount: fishTX.from, tx: fishTX.transactionHash })
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
        this.log.error('Failed fishing chunk', e.message, e, { tofish })
      }
    }
    if (accounts.length > 0)
      sendSlackAlert({ msg: 'info: fishing done', unfished: unfished.length, failed, outof: accounts.length })

    if (unfished.length > 0) {
      this.log.info('Retrying unfished accounts', { unfished: unfished.length })
      return await this.fish(unfished, fishers)
    }
    return fishers
  }

  /**
   * transfers recovered funds by fishing back to UBI
   * @returns the amount transfered
   */
  transferFishToUBI = async () => {
    let gdbalance = await AdminWallet.tokenContract.read.balanceOf([AdminWallet.proxyContract.address]).then(parseInt)
    if (gdbalance > 0) {
      const transferTX = await AdminWallet.transferWalletGoodDollars(
        AdminWallet.UBIContract.address,
        gdbalance,
        this.log
      )
      this.log.info('transfered fished funds to ubi', { tx: transferTX.transactionHash, gdbalance })
    }
    return gdbalance
  }

  run = async forceDaysAgo => {
    try {
      const inactive = await this.getInactiveAccounts(forceDaysAgo)
      const fishers = await this.fish(inactive)
      const cronTime = await this.getNextDay()
      await this.transferFishToUBI().catch() //silence exceptions, as they will be error logged in wallet
      return { result: true, cronTime, fishers, inactive: inactive.length }
    } catch (exception) {
      const { message } = exception
      this.log.error('fishing task failed:', message, exception)
      sendSlackAlert({ msg: 'failure: fishing failed', error: message })

      const cronTime = moment().add(1, 'hour')
      return { result: true, cronTime }
    }
  }
}

export const fishManager = new FishingManager()

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

export class CollectFundsTask extends StakingModelTask {
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

export class FishInactiveTask extends StakingModelTask {
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

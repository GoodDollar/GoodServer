import FundManagerABI from '@gooddollar/goodprotocol/artifacts/contracts/staking/GoodFundManager.sol/GoodFundManager.json'
import StakingABI from '@gooddollar/goodprotocol/artifacts/contracts/staking/SimpleStaking.sol/SimpleStaking.json'
import UBISchemeABI from '@gooddollar/goodprotocol/artifacts/contracts/ubi/UBIScheme.sol/UBIScheme.json'
import NameServiceABI from '@gooddollar/goodprotocol/artifacts/contracts/utils/NameService.sol/NameService.json'

//needed for ropsten allocateTo - mint fake dai
import DaiABI from '@gooddollar/goodcontracts/build/contracts/DAIMock.min.json'
import cDaiABI from '@gooddollar/goodprotocol/artifacts/contracts/Interfaces.sol/cERC20.json'
import ContractsAddress from '@gooddollar/goodprotocol/releases/deployment.json'
import fetch from 'cross-fetch'
import AdminWallet from './AdminWallet'
import { get, chunk, range, flatten, mapValues } from 'lodash'
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
  homeAddresses = get(ContractsAddress, AdminWallet.network)
  managerAddress = this.addresses['GoodFundManager']
  stakingAddresses = this.addresses['StakingContracts']
  daiAddress = this.addresses['DAI']
  cDaiAddress = this.addresses['cDAI']
  bridge = this.addresses['ForeignBridge']
  nameServiceAddress = this.addresses['NameService']

  constructor() {
    this.log = logger.child({ from: 'StakingModelManagerV2' })
    this.init()
    // this.managerContract.methods.bridgeContract().call().then(_ => (this.bridge = _))
    // this.managerContract.methods.ubiRecipient().call().then(_ => (this.ubiScheme = _))
  }

  init = async () => {
    //polling timeout since ethereum has network congestion and we try to pay little gas so it will take a long time to confirm tx
    await AdminWallet.ready
    this.managerContract = new AdminWallet.mainnetWeb3.eth.Contract(FundManagerABI.abi, this.managerAddress, {
      transactionPollingTimeout: 1000,
      from: AdminWallet.address
    })
    this.stakingContract = new AdminWallet.mainnetWeb3.eth.Contract(StakingABI.abi, this.stakingAddresses[0][0], {
      from: AdminWallet.address
    })
    this.dai = new AdminWallet.mainnetWeb3.eth.Contract(DaiABI.abi, this.daiAddress, { from: AdminWallet.address })
    this.cDai = new AdminWallet.mainnetWeb3.eth.Contract(cDaiABI.abi, this.cDaiAddress, { from: AdminWallet.address })
    this.nameService = new AdminWallet.mainnetWeb3.eth.Contract(NameServiceABI.abi, this.nameServiceAddress, {
      from: AdminWallet.address
    })
    this.log.debug('constructor:', {
      fundmanager: this.managerAddress,
      staking: this.stakingAddresses,
      bridge: this.bridge
    })
  }
  canCollectFunds = async () => {
    const result = await this.managerContract.methods.calcSortedContracts().call()
    this.log.info('canCollectFunds:', result)
    //collect all contracts that can be run
    const contracts = result.filter(_ => _.maxGasLargerOrEqualRequired).map(_ => _.contractAddress)

    return contracts.length > 0 ? contracts : false
  }

  getAvailableInterest = async () =>
    this.stakingContract.methods
      .currentGains(true, true)
      .call()
      .then(_ => mapValues(_, parseInt))

  transferInterest = async () => {
    let txHash
    const stakingContracts = await this.canCollectFunds()
    if (stakingContracts === false) {
      this.log.warn('transferInterest no staking contracts')
      return
    }

    try {
      const fundsTX = await AdminWallet.sendTransactionMainnet(
        this.managerContract.methods.collectInterest(stakingContracts, false),
        { onTransactionHash: h => (txHash = h) },
        { gas: 2000000 }, //force fixed gas price, tx should take around 450k
        AdminWallet.mainnetAddresses[0]
      )
      const fundsEvent = get(fundsTX, 'events.FundsTransferred')
      this.log.info('transferInterest result event', { fundsEvent, fundsTX })
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
    let retry = 0
    while (true) {
      retry += 1
      this.log.info('retrying timedout tx', { txHash, retry })
      const receipt = await AdminWallet.mainnetWeb3.eth.getTransactionReceipt(txHash)
      if (receipt) {
        if (receipt.status) {
          const fundsEvents = await this.managerContract.getPastEvents('FundsTransferred', {
            fromBlock: receipt.blockNumber,
            toBlock: receipt.blockNumber
          })
          const fundsEvent = get(fundsEvents, 0)
          this.log.info('retrying timedout tx success transferInterest result event', { txHash, fundsEvent })
          return fundsEvent
        }
        //tx eventually failed
        throw new Error('retrying timedout tx failed txHash: ' + txHash)
      }
      //no receipt yet wait 10 minutes
      await delay(1000 * 60 * 10)
    }
  }

  getNextCollectionTime = async () => {
    let canCollectFunds = await this.canCollectFunds()
    const blocksForNextCollection = 4 * 60 * 24 //wait 1 day
    this.log.info('canRun result:', { canCollectFunds, blocksForNextCollection })
    if (canCollectFunds === false) {
      return moment().add(blocksForNextCollection * 15, 'seconds')
    }
    return moment()
  }

  mockInterest = async () => {
    this.log.info('mockInterest: start', { mainnetAddresses: AdminWallet.mainnetAddresses })
    if (config.ethereumMainnet.network_id === 1) {
      return
    }
    //top ropsten wallet
    if (moment().diff(this.lastRopstenTopping, 'days') > 0) {
      fetch('https://faucet.metamask.io', { method: 'POST', body: AdminWallet.mainnetAddresses[0] }).catch(e => {
        this.log.error('mockInterest: failed calling ropsten faucet', e.message, e)
      })
      this.lastRopstenTopping = moment()
    }
    await AdminWallet.sendTransactionMainnet(
      this.dai.methods.approve(this.cDai._address, toWei('1000000000', 'ether')),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(e => {
      this.log.warn('mockInterest: dai  approve failed')
      // throw e
    })
    await AdminWallet.sendTransactionMainnet(
      this.dai.methods.allocateTo(AdminWallet.mainnetAddresses[0], toWei('2000', 'ether')),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(e => {
      this.log.warn('mockInterest: dai  allocateTo failed', e.message, e)
      // throw e
    })

    const balanceBefore = await this.cDai.methods
      .balanceOf(AdminWallet.mainnetAddresses[0])
      .call()
      .then(parseInt)
    this.log.info('mockInterest: approved and allocated dai. minting cDai...', { balanceBefore })
    await AdminWallet.sendTransactionMainnet(
      this.cDai.methods.mint(toWei('2000', 'ether')),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(e => {
      this.log.warn('mockInterest: cdai mint failed', e.message, e)
    })

    let ownercDaiBalanceAfter = await this.cDai.methods
      .balanceOf(AdminWallet.mainnetAddresses[0])
      .call()
      .then(parseInt)

    let toTransfer = ownercDaiBalanceAfter - balanceBefore
    this.log.info('mockInterest: minted fake cDai, transferring to staking contract...', {
      ownercDaiBalanceAfter,
      toTransfer,
      owner: AdminWallet.mainnetAddresses[0],
      stakingContract: this.stakingContract._address
    })

    toTransfer = toTransfer > 0 ? toTransfer : (balanceBefore / 7).toFixed(0)
    if (toTransfer === 0) {
      this.log.warn('mockInterest: no mock interest to transfer to staking contract...')
      return
    }
    await AdminWallet.sendTransactionMainnet(
      this.cDai.methods.transfer(this.stakingContract._address, toTransfer),
      {},
      {},
      AdminWallet.mainnetAddresses[0]
    ).catch(e => {
      this.log.warn('mockInterest: transfer interest failed', e.message, e)
    })

    let stakingcDaiBalanceAfter = await this.cDai.methods.balanceOf(this.stakingContract._address).call()

    this.log.info('mockInterest: transfered fake cDai to staking contract...', {
      stakingcDaiBalanceAfter
    })
  }
  run = async () => {
    try {
      await this.mockInterest().catch(e => {
        this.log.warn('mockInterest failed, continuing...')
        sendSlackAlert({ msg: 'failure: mockInterest failed', error: e.message })
      })
      this.log.info('mockInterest done, collecting interest...')
      const nextCollectionTime = await this.getNextCollectionTime()
      this.log.info({ nextCollectionTime })
      if (nextCollectionTime.isAfter()) {
        this.log.info('waiting for collect interest time', { nextCollectionTime })
        return { result: 'waiting', cronTime: nextCollectionTime }
      }
      const availableInterest = await this.getAvailableInterest()
      this.log.info('starting collect interest', {
        availableInterest,
        nextCollectionTime: nextCollectionTime.toString()
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
          ubiGenerated: transferEvent.returnValues.value
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
    const ubiRecipient = await this.nameService.methods.getAddress('UBI_RECIPIENT').call()
    const res = await AdminWallet.tokenContract.getPastEvents('Transfer', {
      fromBlock,
      filter: {
        to: ubiRecipient,
        value
      }
    })
    this.log.info('waitforBirgdeTransfer events:', {
      fromBlock,
      start,
      res,
      bridge: this.homeBridge,
      ubi: ubiRecipient
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
    this.ubiContract = new AdminWallet.web3.eth.Contract(UBISchemeABI.abi, this.ubiScheme, {
      from: AdminWallet.address
    })
  }

  /**
   * calculate the next claim epoch
   */
  getNextDay = async () => {
    const startRef = await this.ubiContract.methods
      .periodStart()
      .call()
      .then(_ => moment(parseInt(_) * 1000).startOf('hour'))
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
  getUBICalculatedDays = async forceDaysAgo => {
    const dayFuseBlocks = (60 * 60 * 24) / 5
    const maxInactiveDays =
      forceDaysAgo ||
      (await this.ubiContract.methods
        .maxInactiveDays()
        .call()
        .then(parseInt))

    const daysagoBlocks = dayFuseBlocks * (maxInactiveDays + 1)
    const curBlock = await AdminWallet.web3.eth.getBlockNumber()
    const blocksAgo = Math.max(curBlock - daysagoBlocks, 0)
    await AdminWallet.sendTransaction(this.ubiContract.methods.setDay(), {}).catch(e =>
      this.log.warn('fishManager set day failed')
    )
    const currentUBIDay = await this.ubiContract.methods
      .currentDay()
      .call()
      .then(parseInt)
    this.log.info('getInactiveAccounts', { daysagoBlocks, blocksAgo, currentUBIDay, maxInactiveDays })
    //get claims that were done before inactive period days ago, these accounts has the potential to be inactive
    //first we get the starting block
    const blockChunks = range(blocksAgo, curBlock, 100000)
    const ubiEvents = flatten(
      await Promise.all(
        blockChunks.map(startBlock =>
          this.ubiContract
            .getPastEvents('UBICalculated', {
              fromBlock: startBlock,
              toBlock: Math.min(curBlock, startBlock + 100000)
            })
            .catch(e => {
              this.log.warn('getUBICalculatedDays getPastEvents UBICalculated chunk failed', e.message, {
                startBlock
              })
              return []
            })
        )
      )
    )
    // const ubiEvents = await this.ubiContract.getPastEvents('UBICalculated', { fromBlock: blocksAgo }).catch(e => {
    //   this.log.warn('fishManager getPastEvents failed')
    //   throw e
    // })
    this.log.info('getUBICalculatedDays ubiEvents:', {
      ubiEvents: ubiEvents.length,
      ubiEventDays: ubiEvents.map(_ => get(_, 'returnValues.day')).map(parseInt)
    })

    //find first day older than maxInactiveDays (ubiEvents is sorted from old to new  so we reverse it)
    const searchStartDay = ubiEvents
      .reverse()
      .find(e => parseInt(e.returnValues.day) <= currentUBIDay - maxInactiveDays)

    const startDay = parseInt(get(searchStartDay, 'returnValues.day', 0))
    //find first day newer than searchStartDay
    const searchEndDay = ubiEvents.reverse().find(e => parseInt(e.returnValues.day) > startDay)
    const endDay = parseInt(get(searchEndDay, 'returnValues.day', 0))

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
    const claimBlockStart = parseInt(
      get(
        searchStartDay,
        'returnValues.blockNumber',
        Math.max((await AdminWallet.web3.eth.getBlockNumber()) - maxInactiveDays * FUSE_DAY_BLOCKS, 0)
      )
    )

    const claimBlockEnd = parseInt(get(searchEndDay, 'returnValues.blockNumber', claimBlockStart + FUSE_DAY_BLOCKS))

    //get candidates
    const chunkSize = 100000
    const blockChunks = range(claimBlockStart, claimBlockEnd, chunkSize)
    const claimEvents = flatten(
      await Promise.all(
        blockChunks.map(startBlock =>
          this.ubiContract
            .getPastEvents('UBIClaimed', {
              fromBlock: startBlock,
              toBlock: Math.min(claimBlockEnd, startBlock + chunkSize)
            })
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
      const isActive = await this.ubiContract.methods
        .isActiveUser(e.returnValues.claimer)
        .call()
        .catch(e => undefined)
      if (isActive === undefined) {
        inactiveCheckFailed += 1
      }
      return isActive ? undefined : e.returnValues.claimer
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
    const fishEvents = await this.ubiContract.getPastEvents('TotalFished', {
      fromBlock: fishTX.blockNumber,
      toBlock: fishTX.blockNumber
    })
    const fishEvent = fishEvents.find(e => e.transactionHash === fishTX.transactionHash)
    const totalFished = parseInt(get(fishEvent, 'returnValues.total', 0))
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
    let gdbalance = await AdminWallet.tokenContract.methods
      .balanceOf(AdminWallet.proxyContract._address)
      .call()
      .then(parseInt)
    if (gdbalance > 0) {
      const transferTX = await AdminWallet.transferWalletGooDollars(this.ubiScheme, gdbalance, this.log)
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

import axios from 'axios'
import { isArray } from 'lodash'
import { retry as retryAttempt } from '../utils/async'

export const getExplorerTxs = async (address, chainId, query, from = null, allPages = true) => {
  const txs = []
  const url = '/api'
  const networkExplorerUrl = Number(chainId) === 122 ? 'https://explorer.fuse.io' : 'https://explorer.celo.org/mainnet'

  const params = { module: 'account', address, sort: 'asc', page: 1, offset: 10000, ...query }

  if (from) {
    params.start_block = from
    params.startblock = from //etherscan
  }

  for (;;) {
    const options = { baseURL: networkExplorerUrl, params }
    const {
      data: { result = [] }
    } = await retryAttempt(
      () =>
        axios
          .get(url, options)
          .then(result => {
            if (isArray(result.data.result)) {
              return result
            }
            throw new Error(`NOTOK ${result.data.result}`)
          })
          .catch(e => {
            if (Number(chainId) === 122) {
              throw e
            }
            //retry with other explorer
            return axios.get(url, { ...options, networkExplorerUrl: 'https://api.celoscan.io' })
          }),
      3,
      1500
    )
    const chunk = result.filter(({ value }) => value !== '0')
    params.page += 1
    txs.push(...chunk)

    if (allPages === false || result.length < params.offset) {
      // default page size by explorer.fuse.io
      break
    }
  }

  return txs
}

export const findFaucetAbuse = async (address, chainId) => {
  const lastTxs = await getExplorerTxs(
    address,
    chainId,
    { action: 'txlist', sort: 'desc', offset: 100 },
    undefined,
    false
  )
  const daysAgo = 3
  // const maxFaucetValue = 0.0075
  const foundAbuse = lastTxs.find(
    _ =>
      _.from.toLowerCase() === address.toLowerCase() &&
      Number(_.value) / 1e18 > 0 &&
      Date.now() / 1000 - Number(_.timeStamp) <= 60 * 60 * 24 * daysAgo
  )

  return foundAbuse
}

export const findGDTx = async (address, chainId, gdAddress) => {
  const lastTxs = await getExplorerTxs(
    address,
    chainId,
    { action: 'tokentx', sort: 'desc', offset: 10, contractaddress: gdAddress },
    undefined,
    false
  )
  const daysAgo = 3
  const foundTx = lastTxs.find(_ => Date.now() / 1000 - Number(_.timeStamp) <= 60 * 60 * 24 * daysAgo)

  return foundTx
}

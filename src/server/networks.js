import { once } from 'lodash'

export default once(() => ({
  1: {
    network_id: 1,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://rpc.ankr.com/eth,https://eth-rpc.gateway.pokt.network,https://cloudflare-eth.com,https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API}`,
    websocketWeb3Provider: 'wss://mainnet.infura.io/ws'
  },
  42: {
    network_id: 42,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://eth-kovan.alchemyapi.io/v2/${process.env.ALCHEMY_API}`,
    websocketWeb3Provider: 'wss://kovan.infura.io/ws'
  },
  3: {
    network_id: 3,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://eth-ropsten.alchemyapi.io/v2/${process.env.ALCHEMY_API}`,
    websocketWeb3Provider: 'wss://ropsten.infura.io/ws'
  },
  5: {
    network_id: 5,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_API}`,
    websocketWeb3Provider: 'wss://goerli.infura.io/ws'
  },
  4447: {
    network_id: 4447,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'http://localhost:8545/',
    websocketWeb3Provider: 'ws://localhost:8545/'
  },
  31337: {
    network_id: 31337,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'http://localhost:8545/',
    websocketWeb3Provider: 'ws://localhost:8545/'
  },
  122: {
    network_id: 122,
    web3Transport: 'HttpProvider',
    httpWeb3Provider:
      (process.env.FUSE_RPC ?? '') +
      ',https://rpc.fuse.io/,https://fuse-mainnet.chainstacklabs.com'
        .split(',')
        .filter(_ => _)
        .join(','),
    websocketWeb3Provider: 'wss://rpc.fuse.io/ws'
  },
  42220: {
    network_id: 42220,
    web3Transport: 'HttpProvider',
    httpWeb3Provider:
      (process.env.CELO_RPC ?? '') +
      ',https://forno.celo.org/,https://rpc.ankr.com/celo,https://1rpc.io/celo'
        .split(',')
        .filter(_ => _)
        .join(','),
    websocketWeb3Provider: ''
  }
}))

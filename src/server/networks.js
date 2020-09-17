import { once } from 'lodash'

export default once(() => ({
  1: {
    network_id: 1,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API}`,
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
  4447: {
    network_id: 4447,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'http://localhost:9545/',
    websocketWeb3Provider: 'ws://localhost:9545/'
  },
  121: {
    network_id: 121,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://rpc.fuse.io/',
    websocketWeb3Provider: 'wss://rpc.fuse.io/ws'
  },
  122: {
    network_id: 122,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: process.env.FUSE_RPC || 'https://fuse.gooddollar.org/',
    websocketWeb3Provider: 'wss://rpc.fuse.io/ws'
  }
}))

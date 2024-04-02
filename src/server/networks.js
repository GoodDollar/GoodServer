import { once } from 'lodash'

export default once(() => {
  const alchemyKey = process.env.ALCHEMY_API
  const fuseRpc = process.env.FUSE_RPC
  const celoRpc = process.env.CELO_RPC
  const mainnetRpc = process.env.MAINNET_RPC

  return {
    1: {
      network_id: 1,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: `https://rpc.ankr.com/eth,https://eth-rpc.gateway.pokt.network,https://cloudflare-eth.com,https://eth-mainnet.alchemyapi.io/v2/${alchemyKey}`,
      websocketWeb3Provider: 'wss://mainnet.infura.io/ws'
    },
    42: {
      network_id: 42,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: `https://eth-kovan.alchemyapi.io/v2/${alchemyKey}`,
      websocketWeb3Provider: 'wss://kovan.infura.io/ws'
    },
    3: {
      network_id: 3,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: `https://eth-ropsten.alchemyapi.io/v2/${alchemyKey}`,
      websocketWeb3Provider: 'wss://ropsten.infura.io/ws'
    },
    11155111: {
      network_id: 11155111,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: mainnetRpc ? mainnetRpc : `https://sepolia.gateway.tenderly.co`,
      websocketWeb3Provider: ''
    },
    5: {
      network_id: 5,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: `https://eth-goerli.alchemyapi.io/v2/${alchemyKey}`,
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
      httpWeb3Provider: fuseRpc ? fuseRpc : 'https://rpc.fuse.io/',
      websocketWeb3Provider: 'wss://rpc.fuse.io/ws'
    },
    42220: {
      network_id: 42220,
      web3Transport: 'HttpProvider',
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: celoRpc ? celoRpc : 'https://forno.celo.org/,https://rpc.ankr.com/celo,https://1rpc.io/celo',
      websocketWeb3Provider: ''
    }
  }
})

const networks = {
  42: {
    network_id: 42,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://kovan.infura.io/v3/${process.env.INFURA_API}`,
    websocketWeb3Provider: 'wss://kovan.infura.io/ws'
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
    httpWeb3Provider: 'https://rpc.fuse.io/',
    websocketWeb3Provider: 'wss://rpc.fuse.io/ws'
  }
}

export default networks

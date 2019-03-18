const networks = {
  kovan: {
    network_id: 42,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: `https://kovan.infura.io/v3/${process.env.INFURA_API}`,
    websocketWeb3Provider: 'wss://kovan.infura.io/ws'
  },
  ganache: {
    network_id: 6000,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'http://localhost:8545/',
    websocketWeb3Provider: 'wss://localhost:8545/ws'
  },
  truffle: {
    network_id: 4447,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'http://localhost:9545/',
    websocketWeb3Provider: 'ws://localhost:9545/ws'
  },
  fuse: {
    network_id: 121,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://rpc.fuse.io/',
    websocketWeb3Provider: 'wss://explorer-node.fuse.io/ws'
  }
}

export default networks

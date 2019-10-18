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
    httpWeb3Provider: 'http://localhost:8545/',
    websocketWeb3Provider: 'ws://localhost:8545/ws'
  },
  121: {
    network_id: 121,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://rpc.fuse.io/',
    websocketWeb3Provider: 'wss://explorer-node.fuse.io/ws'
  },
  122: {
    network_id: 122,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://rpc.fusenet.io/',
    websocketWeb3Provider: 'wss://explorer-node.fusenet.io/ws'
  }
}

export default networks

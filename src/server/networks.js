const networks = {
  kovan: {
    network_id: 42,
    httpWeb3Provider: 'https://kovan.infura.io/v3/',
    websocketWeb3Provider: 'wss://kovan.infura.io/ws'
  },
  truffle: {
    network_id: 4447,
    httpWeb3Provider: 'http://localhost:9545/',
    websocketWeb3Provider: 'wss://localhost:9545/ws'
  }
}

export default networks

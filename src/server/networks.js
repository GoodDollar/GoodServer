const networks = {
  kovan: {
    network_id: 42,
    httpWeb3Provider: `https://kovan.infura.io/v3/${process.env.INFURA_API}`,
    websocketWeb3Provider: 'wss://kovan.infura.io/ws'
  },
  truffle: {
    network_id: 4447,
    httpWeb3Provider: 'http://localhost:9545/',
    websocketWeb3Provider: 'wss://localhost:9545/ws'
  },
  fuse: {
    network_id: 121,
    httpWeb3Provider: 'https://rpc.fuse.io/',
    websocketWeb3Provider: 'wss://explorer.fuse.io/socket/websocket'
  }
}

export default networks

import { once } from 'lodash'

export default once(() => {
  const alchemyKey = process.env.ALCHEMY_API
  const fuseRpc = process.env.FUSE_RPC
  const celoRpc = process.env.CELO_RPC
  const mainnetRpc = process.env.MAINNET_RPC
  const baseRpc = process.env.BASE_RPC
  const xdcRpc = process.env.XDC_RPC

  const fuseExplorers = process.env.FUSE_EXPLORERS || 'https://explorer.fuse.io/api'
  const celoExplorers = process.env.CELO_EXPLORERS || 'https://celo.blockscout.com/api,https://api.celoscan.io/api'
  const baseExplorers = process.env.BASE_EXPLORERS || 'https://base.blockscout.com/api'
  const xdcExplorers = process.env.XDC_EXPLORERS || 'https://api.etherscan.io/v2/api'
  return {
    1: {
      network_id: 1,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: `https://rpc.flashbots.net,https://eth-rpc.gateway.pokt.network,https://cloudflare-eth.com,https://eth-mainnet.alchemyapi.io/v2/${alchemyKey}`,
      websocketWeb3Provider: 'wss://mainnet.infura.io/ws',
      explorer: ''
    },
    11155111: {
      network_id: 11155111,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: mainnetRpc
        ? mainnetRpc
        : `https://ethereum-sepolia-rpc.publicnode.com,https://rpc2.sepolia.org,https://eth-sepolia.public.blastapi.io,https://sepolia.drpc.org,https://sepolia.gateway.tenderly.co`,
      websocketWeb3Provider: '',
      explorer: ''
    },
    4447: {
      network_id: 4447,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: 'http://localhost:8545/',
      websocketWeb3Provider: 'ws://localhost:8545/',
      explorer: ''
    },
    31337: {
      network_id: 31337,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: 'http://localhost:8545/',
      websocketWeb3Provider: 'ws://localhost:8545/',
      explorer: ''
    },
    122: {
      network_id: 122,
      web3Transport: 'HttpProvider',
      httpWeb3Provider: fuseRpc ? fuseRpc : 'https://rpc.fuse.io/',
      websocketWeb3Provider: 'wss://rpc.fuse.io/ws',
      explorer: fuseExplorers
    },
    42220: {
      network_id: 42220,
      web3Transport: 'HttpProvider',
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: celoRpc ? celoRpc : 'https://forno.celo.org/',
      websocketWeb3Provider: '',
      explorer: celoExplorers
    },
    50: {
      network_id: 50,
      web3Transport: 'HttpProvider',
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: xdcRpc ? xdcRpc : 'https://rpc.xdc.network/',
      websocketWeb3Provider: '',
      explorer: xdcExplorers
    },
    8453: {
      network_id: 8453,
      web3Transport: 'HttpProvider',
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: baseRpc ? baseRpc : 'https://mainnet.base.org,https://rpc.ankr.com/base,https://1rpc.io/base',
      websocketWeb3Provider: '',
      explorer: baseExplorers
    }
  }
})

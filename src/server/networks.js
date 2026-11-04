import { once } from 'lodash'

export default once(() => {
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
      httpWeb3Provider: `https://mainnet.gateway.tenderly.co,https://eth.drpc.org`,
      explorer: ''
    },
    11155111: {
      network_id: 11155111,
      httpWeb3Provider: mainnetRpc
        ? mainnetRpc
        : `https://ethereum-sepolia-rpc.publicnode.com,https://rpc2.sepolia.org,https://eth-sepolia.public.blastapi.io,https://sepolia.drpc.org,https://sepolia.gateway.tenderly.co`,
      explorer: ''
    },
    4447: {
      network_id: 4447,
      httpWeb3Provider: 'http://localhost:8545/',
      explorer: ''
    },
    31337: {
      network_id: 31337,
      httpWeb3Provider: 'http://localhost:8545/',
      explorer: ''
    },
    122: {
      network_id: 122,
      httpWeb3Provider: fuseRpc ? fuseRpc : 'https://rpc.fuse.io/',
      explorer: fuseExplorers
    },
    42220: {
      network_id: 42220,
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: celoRpc ? celoRpc : 'https://forno.celo.org/',
      explorer: celoExplorers
    },
    50: {
      network_id: 50,
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: xdcRpc ? xdcRpc : 'https://rpc.xdc.network',
      explorer: xdcExplorers
    },
    8453: {
      network_id: 8453,
      // eslint-disable-next-line prettier/prettier
      httpWeb3Provider: baseRpc ? baseRpc : 'https://mainnet.base.org,https://rpc.ankr.com/base,https://1rpc.io/base',
      explorer: baseExplorers
    }
  }
})

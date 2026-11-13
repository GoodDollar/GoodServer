import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  numberToHex,
  parseAbi,
  parseEther,
  zeroHash
} from 'viem'
import { celo } from 'viem/chains'
import { validateLocalRpcUrl } from './anvil.node.cjs'

export const developmentOwner = '0x2CeADe86A04e474F3cf9BD87208514d818010627'

const adminAbi = parseAbi([
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function addAdmins(address[] admins)'
])

export const createAnvilFork = ({ rpcUrl, deployment, owner = developmentOwner }) => {
  if (!rpcUrl) throw new Error('The test setup must start Anvil before creating fork clients.')
  validateLocalRpcUrl(rpcUrl)
  if (!isAddress(owner)) throw new Error('CELO_FORK_OWNER must be a valid Ethereum address.')
  const transport = () => http(rpcUrl, { retryCount: 0, timeout: 30000, fetchOptions: { redirect: 'error' } })
  const chain = { ...celo, fees: { ...celo.fees, baseFeeMultiplier: 2 }, rpcUrls: { default: { http: [rpcUrl] } } }
  const publicClient = createPublicClient({ chain, transport: transport(), cacheTime: 0, pollingInterval: 100 })
  const walletClient = createWalletClient({ chain, transport: transport() })
  let snapshot

  const setBalance = (addresses, amount = parseEther('100')) =>
    Promise.all(
      addresses.map(address =>
        publicClient.request({ method: 'anvil_setBalance', params: [address, numberToHex(amount)] })
      )
    )

  const initialize = async () => {
    if ((await publicClient.getChainId()) !== celo.id) throw new Error('The Anvil fork must use Celo chain ID 42220.')
    for (const name of ['AdminWallet', 'Identity', 'GoodDollar', 'Faucet']) {
      const address = deployment[name]
      const code = address && (await publicClient.getBytecode({ address }))
      if (!code || code === '0x') throw new Error(`Missing development-celo ${name} contract at the fork block.`)
    }
    const isOwner = await publicClient.readContract({
      address: deployment.AdminWallet,
      abi: adminAbi,
      functionName: 'hasRole',
      args: [zeroHash, owner]
    })
    if (!isOwner)
      throw new Error('CELO_FORK_OWNER must have DEFAULT_ADMIN_ROLE on the development-celo AdminWallet contract.')
    snapshot = await publicClient.request({ method: 'evm_snapshot', params: [] })
    await setBalance([owner, deployment.AdminWallet, deployment.Faucet])
  }

  const prepareAccounts = async addresses => {
    if (!addresses.length) throw new Error('No test wallet accounts were initialized.')
    await setBalance(addresses)
    await publicClient.request({ method: 'anvil_impersonateAccount', params: [owner] })
    try {
      const fees = await publicClient.estimateFeesPerGas()
      const hash = await walletClient.writeContract({
        account: owner,
        address: deployment.AdminWallet,
        abi: adminAbi,
        functionName: 'addAdmins',
        args: [addresses],
        gas: 1000000n,
        ...fees
      })
      await publicClient.request({ method: 'evm_mine', params: [] })
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30000 })
      if (receipt.status !== 'success') throw new Error('Impersonated addAdmins transaction reverted.')
    } finally {
      await publicClient.request({ method: 'anvil_stopImpersonatingAccount', params: [owner] })
    }
  }

  const restore = async () => {
    if (!snapshot) return
    const reverted = await publicClient.request({ method: 'evm_revert', params: [snapshot] })
    if (!reverted) throw new Error('Failed to restore the Anvil fork snapshot.')
    snapshot = undefined
  }

  return { publicClient, walletClient, initialize, prepareAccounts, restore, setBalance }
}

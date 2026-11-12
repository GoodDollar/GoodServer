const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { createPublicClient, http } = require('viem')

const validateForkConfig = ({ archiveRpcUrl, blockNumber }) => {
  if (!archiveRpcUrl) throw new Error('Set CELO_ARCHIVE_RPC_URL to an archive Celo RPC URL.')
  const url = new URL(archiveRpcUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('CELO_ARCHIVE_RPC_URL must use HTTPS, or HTTP on localhost.')
  }
  if (!/^\d+$/.test(String(blockNumber)) || !Number.isSafeInteger(Number(blockNumber)) || Number(blockNumber) <= 0) {
    throw new Error('Set CELO_FORK_BLOCK_NUMBER to a positive decimal block number.')
  }
  return { archiveRpcUrl, blockNumber: Number(blockNumber) }
}

const validateLocalRpcUrl = rpcUrl => {
  const url = new URL(rpcUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) {
    throw new Error('CELO_FORK_RPC_URL must be a local Anvil HTTP endpoint.')
  }
  return rpcUrl
}

const stopProcess = async child => {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    timer.unref()
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

const startAnvil = async options => {
  const { archiveRpcUrl, blockNumber } = validateForkConfig(options)
  const port = await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(error => (error ? reject(error) : resolve(port)))
    })
  })
  const rpcUrl = validateLocalRpcUrl(`http://127.0.0.1:${port}`)
  const child = spawn(
    'anvil',
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '42220',
      '--fork-url',
      archiveRpcUrl,
      '--fork-block-number',
      String(blockNumber),
      '--no-storage-caching',
      '--silent'
    ],
    { stdio: 'ignore' }
  )
  let spawnError, rpcError
  child.on('error', error => {
    spawnError = error
  })
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 1000, retryCount: 0, fetchOptions: { redirect: 'error' } }),
    cacheTime: 0
  })
  try {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (spawnError)
        throw new Error('Could not start Anvil. Install Foundry and ensure anvil is on PATH.', { cause: spawnError })
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Anvil exited before startup. Check archive RPC access and the fork block.')
      try {
        if ((await client.getChainId()) === 42220 && (await client.getBlockNumber()) === BigInt(blockNumber)) {
          return { rpcUrl, stop: () => stopProcess(child) }
        }
      } catch (error) {
        rpcError = error
      }
      await delay(100)
    }
    throw new Error('Anvil startup timed out. Check archive RPC access and the fork block.', { cause: rpcError })
  } catch (error) {
    await stopProcess(child)
    throw error
  }
}

module.exports = { startAnvil, validateForkConfig, validateLocalRpcUrl }

// import viemFallbackClient directly to prevent other packages from being imported inadvertently
import { createViemFallbackClient } from '@goodwidget/core/viemFallbackClient'
import { Web3Wallet } from '../Web3Wallet'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, parseAbi } from 'viem'
import { fuse } from 'viem/chains'

jest.mock('@goodwidget/core/viemFallbackClient', () => ({ createViemFallbackClient: jest.fn() }))
jest.mock('../../server.config', () => ({ env: 'test', fuse: { network_id: 122 } }))
jest.mock('../../../imports/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), trace: jest.fn() }
  return { child: () => log }
})
jest.mock('../../utils/tx-manager', () => ({ getManager: jest.fn() }))
jest.mock('../../../imports/slack', () => ({ sendSlackAlert: jest.fn() }))
jest.mock('../KMSWallet', () => ({ KMSWallet: jest.fn() }))

describe('viem wallet', () => {
  let wallet, publicClient, walletClient, factory

  beforeEach(() => {
    publicClient = { request: jest.fn() }
    walletClient = { extend: jest.fn().mockReturnThis() }
    factory = {
      createPublicClient: jest.fn().mockResolvedValue(publicClient),
      createWalletClient: jest.fn().mockResolvedValue(walletClient)
    }
    createViemFallbackClient.mockReturnValue(factory)
    wallet = new Web3Wallet('test', {
      env: 'test',
      fuse: { network_id: 122, httpWeb3Provider: 'https://rpc.fuse.io,https://rpc2.fuse.io' }
    })
  })

  test('uses the GoodWidget factory with all configured RPCs and the configured chain', async () => {
    await expect(wallet.createClients()).resolves.toEqual({ publicClient, walletClient })
    expect(createViemFallbackClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ chainIds: [122], rank: false })
    )
    const clientOptions = {
      chain: expect.objectContaining({ id: 122 }),
      fallbackRpcs: ['https://rpc.fuse.io', 'https://rpc2.fuse.io']
    }
    expect(factory.createPublicClient).toHaveBeenCalledWith(clientOptions)
    expect(factory.createWalletClient).toHaveBeenCalledWith(clientOptions)
  })

  test('passes local HTTP RPCs and the configured chain to the GoodWidget factory', async () => {
    await wallet.createClients({ network_id: 4447, httpWeb3Provider: 'http://localhost:8545' })
    const clientOptions = {
      chain: expect.objectContaining({ id: 4447 }),
      fallbackRpcs: ['http://localhost:8545']
    }
    expect(factory.createPublicClient).toHaveBeenCalledWith(clientOptions)
    expect(factory.createWalletClient).toHaveBeenCalledWith(clientOptions)
  })

  test('encodes contract transactions without a Web3 contract', () => {
    const abi = parseAbi(['function authenticate(address account)'])
    const address = privateKeyToAccount(generatePrivateKey()).address
    expect(wallet.contractTransaction({ abi, address }, 'authenticate', [address])).toEqual({
      to: address,
      data: encodeFunctionData({ abi, functionName: 'authenticate', args: [address] })
    })
  })

  test('the published GoodWidget factory creates a native fallback transport', async () => {
    const actual = jest.requireActual('@goodwidget/core/viemFallbackClient')
    const cache = JSON.stringify({
      fetchedAt: new Date().toISOString(),
      rpcs: [{ chainId: 122, rpcs: ['https://rpc.fuse.io'] }]
    })
    const actualFactory = actual.createViemFallbackClient({ get: () => cache }, { rank: false })
    const client = await actualFactory.createPublicClient({ chain: fuse, fallbackRpcs: ['https://rpc2.fuse.io'] })
    expect(client.transport.type).toBe('fallback')
    expect(client.transport.transports[0].value.url).toBe('https://rpc2.fuse.io')
  })

  test('handles viem bigint fee history without interpreting decimal values as hex', async () => {
    wallet.publicClient = {
      getFeeHistory: jest.fn().mockResolvedValue({ baseFeePerGas: [100n, 110n], reward: [[4n], [7n]] })
    }
    await expect(wallet.getFeeEstimates()).resolves.toEqual({ baseFee: 121, priorityFee: 4 })
  })

  test('preserves string balance results at the wallet boundary', async () => {
    wallet.publicClient = { getBalance: jest.fn().mockResolvedValue(1000000000000000000n) }
    wallet.address = privateKeyToAccount(generatePrivateKey()).address
    await expect(wallet.getAddressBalance(wallet.address)).resolves.toBe('1000000000000000000')
    await expect(wallet.getBalance()).resolves.toBe(1)
  })

  test('re-authenticates previously whitelisted identities using viem tuple output', async () => {
    const address = privateKeyToAccount(generatePrivateKey()).address
    wallet.isVerified = jest.fn().mockResolvedValue(false)
    wallet.identityContract = {
      read: {
        identities: jest.fn().mockResolvedValue([0n, 0n, 'did:gd:test', 122n, 1]),
        lastAuthenticated: jest.fn().mockResolvedValue(0n)
      }
    }
    wallet.authenticateUser = jest.fn().mockResolvedValue({ status: true })
    await expect(wallet.whitelistUser(address, 'did:gd:test')).resolves.toEqual({ status: true })
    expect(wallet.authenticateUser).toHaveBeenCalledWith(address, wallet.log)
  })

  test('converts KMS transaction values, gas and fees to decimal strings', async () => {
    const address = privateKeyToAccount(generatePrivateKey()).address
    wallet.kmsWallet = { signTransaction: jest.fn().mockResolvedValue('0xsigned') }
    wallet._supportsEIP1559 = true
    await wallet._signTransactionWithKMS({ to: address, data: '0x', value: 12n }, address, {
      gas: 21000n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 2n,
      nonce: 3,
      chainId: 122
    })
    expect(wallet.kmsWallet.signTransaction).toHaveBeenCalledWith(address, {
      to: address,
      data: '0x',
      value: '12',
      gasLimit: '21000',
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '2',
      nonce: 3,
      chainId: 122
    })
  })

  describe('nonce queue', () => {
    let address, tx

    beforeEach(() => {
      jest.useFakeTimers()
      address = privateKeyToAccount(generatePrivateKey()).address
      wallet.address = address
      wallet.filledAddresses = [address]
      wallet.publicClient = { getTransactionCount: jest.fn().mockResolvedValue(5) }
      wallet.txManager = {
        lock: jest.fn().mockResolvedValue({ address, nonce: 3, release: jest.fn() }),
        unlock: jest.fn().mockResolvedValue()
      }
      wallet.normalizeGasPricing = jest.fn().mockResolvedValue({ gasPrice: 2n })
      wallet._sendViemTransaction = jest.fn().mockResolvedValue({ status: true })
      tx = { to: address, data: '0x' }
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    test('keeps an explicit sender during nonce-error recovery', async () => {
      wallet._sendViemTransaction.mockRejectedValueOnce(new Error('nonce too low'))
      await expect(wallet.sendTransaction(tx, {}, { gas: 21000, from: address })).resolves.toEqual({ status: true })
      expect(wallet.txManager.unlock).toHaveBeenCalledWith(address, 5)
      expect(wallet.txManager.lock).toHaveBeenNthCalledWith(1, [address])
      expect(wallet.txManager.lock).toHaveBeenNthCalledWith(2, [address])
    })

    test('unlocks and rejects reverted transactions without retrying', async () => {
      wallet._sendViemTransaction.mockRejectedValue(new Error('execution reverted'))
      await expect(wallet.sendTransaction(tx, {}, { gas: 21000 })).rejects.toThrow('execution reverted')
      expect(wallet._sendViemTransaction).toHaveBeenCalledTimes(1)
      expect(wallet.txManager.unlock).toHaveBeenCalledWith(address, 5)
    })

    test('classifies viem errors by details instead of nonce fields in request arguments', async () => {
      const error = Object.assign(new Error('Missing or invalid parameters.\nRequest Arguments:\n  nonce: 3'), {
        details: 'execution reverted: transfer not allowed'
      })
      wallet._sendViemTransaction.mockRejectedValueOnce(error)
      await expect(wallet.sendTransaction(tx, {}, { gas: 21000 })).rejects.toThrow(error.details)
      expect(wallet._sendViemTransaction).toHaveBeenCalledTimes(1)
      expect(wallet.txManager.unlock).toHaveBeenCalledWith(address, 5)
    })

    test('routes native sends through the same queue with wei values intact', async () => {
      await wallet.sendNative({ from: address, to: address, value: '12' }, {}, { gas: 21000 })
      expect(wallet.txManager.lock).toHaveBeenCalledWith([address])
      expect(wallet._sendViemTransaction).toHaveBeenCalledWith(
        { to: address, value: '12' },
        address,
        expect.objectContaining({ gas: 21000, nonce: 3 }),
        {},
        expect.any(Object)
      )
    })
  })

  describe('transaction submission', () => {
    let account, tx, receipt, callbacks, context

    beforeEach(() => {
      account = privateKeyToAccount(generatePrivateKey())
      wallet.addWallet(account)
      tx = { to: account.address, value: '12' }
      receipt = {
        transactionHash: '0x123',
        status: 'success',
        blockNumber: 5n,
        gasUsed: 21000n,
        cumulativeGasUsed: 21000n
      }
      publicClient.chain = { id: 122 }
      publicClient.waitForTransactionReceipt = jest.fn().mockResolvedValue(receipt)
      publicClient.sendRawTransaction = jest.fn().mockResolvedValue('0x123')
      walletClient.sendTransaction = jest.fn().mockResolvedValue('0x123')
      wallet.publicClient = publicClient
      wallet.walletClient = walletClient
      callbacks = { onTransactionHash: jest.fn(), onReceipt: jest.fn(), onConfirmation: jest.fn(), onError: jest.fn() }
      context = { release: jest.fn(), onTxHash: jest.fn() }
    })

    test('signs locally, releases on hash and preserves receipt callbacks and types', async () => {
      const result = await wallet._sendViemTransaction(
        tx,
        account.address,
        { gas: 21000, nonce: 3 },
        callbacks,
        context
      )
      expect(walletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ account, gas: 21000n, nonce: 3, value: 12n })
      )
      expect(context.release).toHaveBeenCalledTimes(1)
      expect(context.onTxHash).toHaveBeenCalledWith('0x123')
      expect(callbacks.onTransactionHash).toHaveBeenCalledWith('0x123')
      expect(result).toMatchObject({ status: true, blockNumber: 5, gasUsed: 21000 })
      expect(callbacks.onReceipt).toHaveBeenCalledWith(result)
      expect(callbacks.onConfirmation).toHaveBeenCalledWith(1, result)
    })

    test('preserves the longer mainnet receipt timeout', async () => {
      await wallet._sendViemTransaction(tx, account.address, {}, callbacks, { ...context, timeout: 600000 })
      expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0x123', timeout: 600000 })
    })

    test('broadcasts KMS signed transactions with the same public fallback client', async () => {
      wallet.addKMSWallet(account.address, 'test-key-id')
      wallet._signTransactionWithKMS = jest.fn().mockResolvedValue('0xsigned')
      await wallet._sendViemTransaction(tx, account.address, { gas: 21000 }, callbacks, context)
      expect(publicClient.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: '0xsigned' })
      expect(walletClient.sendTransaction).not.toHaveBeenCalled()
      expect(wallet._signTransactionWithKMS).toHaveBeenCalledWith(
        tx,
        account.address,
        expect.objectContaining({ chainId: 122, value: 12n })
      )
    })

    test('rejects reverted receipts without reporting success', async () => {
      publicClient.waitForTransactionReceipt.mockResolvedValue({ ...receipt, status: 'reverted' })
      await expect(wallet._sendViemTransaction(tx, account.address, {}, callbacks, context)).rejects.toThrow('reverted')
      expect(callbacks.onReceipt).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledTimes(1)
    })

    test('does not release the nonce on failed broadcast', async () => {
      walletClient.sendTransaction.mockRejectedValue(new Error('nonce too low'))
      await expect(wallet._sendViemTransaction(tx, account.address, {}, callbacks, context)).rejects.toThrow(
        'nonce too low'
      )
      expect(context.release).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledTimes(1)
    })

    test.each(['local', 'KMS'])('reports only viem details for failed %s broadcasts', async signer => {
      const error = Object.assign(new Error('Missing or invalid parameters.\nRequest Arguments:\n  nonce: 163'), {
        details: 'Transaction requires at least 21000 gas but got 10',
        code: -32602
      })
      if (signer === 'KMS') {
        wallet.addKMSWallet(account.address, 'test-key-id')
        wallet._signTransactionWithKMS = jest.fn().mockResolvedValue('0xsigned')
        publicClient.sendRawTransaction.mockRejectedValue(error)
      } else {
        walletClient.sendTransaction.mockRejectedValue(error)
      }

      const rejection = await wallet
        ._sendViemTransaction(tx, account.address, { gas: 10 }, callbacks, context)
        .catch(error => error)

      expect(rejection).toBeInstanceOf(Error)
      expect(rejection.message).toBe(error.details)
      expect(rejection.cause).toBe(error)
      expect(rejection.code).toBe(error.code)
      expect(callbacks.onError).toHaveBeenCalledWith(rejection)
      expect(context.release).not.toHaveBeenCalled()
    })
  })
})

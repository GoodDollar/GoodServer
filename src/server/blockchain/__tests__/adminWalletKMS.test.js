// Mock MongoDB connection to prevent database connection during tests
// This must be done before any imports that might trigger MongoDB connection
// Even when enableMongoLock is false, queueMongo is still imported, which triggers MongoDB connection
// Uses the shared mock from src/server/db/__mocks__/mongo-db.js
import conf from '../../server.config'

jest.mock('../../db/mongo-db')

jest.mock('@gooddollar/kms-ethereum-signing', () => {
  if (process.env.CELO_FORK_REAL_KMS === 'true') return jest.requireActual('@gooddollar/kms-ethereum-signing')
  const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts')
  const account = privateKeyToAccount(generatePrivateKey())
  return {
    getEthereumAddress: jest.fn(async () => account.address),
    signTransaction: jest.fn(async (_keyId, transaction) => {
      const { gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas, value, ...params } = transaction
      return account.signTransaction({
        ...params,
        gas: BigInt(gasLimit),
        value: BigInt(value ?? 0),
        ...(gasPrice !== undefined ? { gasPrice: BigInt(gasPrice) } : {}),
        ...(maxFeePerGas !== undefined ? { maxFeePerGas: BigInt(maxFeePerGas) } : {}),
        ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas) } : {})
      })
    })
  }
})

import './__util__/anvil.setup'
import { signTransaction } from '@gooddollar/kms-ethereum-signing'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createAdminWallet } from '../AdminWallet'

const generateWalletAddress = () => privateKeyToAccount(generatePrivateKey()).address
const useRealKMS = process.env.AWS_SECRET_ACCESS_KEY !== undefined ? true : false

/**
 * Test suite for AdminWallet KMS (AWS Key Management Service) transaction submission
 *
 * These tests verify that AdminWallet can submit transactions using KMS keys
 * instead of local private keys. KMS provides enhanced security by keeping
 * private keys in AWS and signing transactions remotely.
 *
 * To run these tests with KMS:
 * 1. Set KMS_KEY_IDS environment variable (comma-separated list of KMS key IDs/aliases)
 * 2. Set AWS_REGION environment variable (e.g., 'us-east-1')
 * 3. Ensure AWS credentials are configured (via AWS CLI, IAM role, or env vars)
 *
 * Regular runs mock the AWS signing boundary with an ephemeral local signer.
 * Set CELO_FORK_REAL_KMS=true to require real AWS KMS signing and credentials.
 */
describe(`AdminWallet KMS Transaction Submission (${useRealKMS ? 'AWS' : 'local signer'})`, () => {
  const AdminWallet = createAdminWallet(true) // Use KMS

  const isKMSConfigured = () => {
    return Boolean(conf.kmsKeysTag || conf.kmsKeyIds)
  }

  beforeAll(async () => {
    if (!useRealKMS) {
      conf.kmsKeyIds = 'fork-test-key'
      conf.kmsKeysTag = undefined
      conf.kmsRegion = 'test'
    }
    if (!isKMSConfigured()) {
      throw new Error('KMS is not configured. Set KMS_KEY_IDS or KMS_KEYS_TAG to enable KMS tests.')
    }
    expect(await AdminWallet.ready).toBe(true)
    expect(AdminWallet.network).toBe('development-celo')
    expect(AdminWallet.publicClient.chain.id).toBe(42220)
    expect(AdminWallet.filledAddresses.length).toBeGreaterThan(0)
  }, 120000) // 2 minute timeout for KMS initialization and blockchain connections

  describe('KMS Configuration', () => {
    test('should detect if KMS is configured', () => {
      const configured = isKMSConfigured()
      console.log('KMS signing mode:', useRealKMS ? 'AWS' : 'ephemeral local signer')
      expect(configured).toBe(true)
    })

    test('should have KMS wallet initialized if KMS is configured', async () => {
      expect(AdminWallet.kmsWallet).toBeDefined()
      expect(AdminWallet.kmsWallet).not.toBeNull()
    })

    test('should have KMS addresses if KMS is configured', async () => {
      expect(AdminWallet.addresses).toBeDefined()
      expect(AdminWallet.addresses.length).toBeGreaterThan(0)

      // Check if at least one address is a KMS wallet
      const hasKMSAddress = AdminWallet.addresses.some(addr => AdminWallet.isKMSWallet(addr))
      expect(hasKMSAddress).toBe(true)
    })

    test('should identify KMS wallet addresses correctly', async () => {
      const kmsAddresses = AdminWallet.addresses.filter(addr => AdminWallet.isKMSWallet(addr))

      expect(kmsAddresses.length).toBeGreaterThan(0)

      // Verify each KMS address has a key ID
      kmsAddresses.forEach(address => {
        const wallet = AdminWallet.wallets[address.toLowerCase()]
        expect(wallet).toBeDefined()
        expect(wallet.isKMS).toBe(true)
        expect(wallet.kmsKeyId).toBeDefined()
        expect(wallet.kmsKeyId).not.toBeNull()
      })
    })
  })

  describe('KMS Transaction Submission', () => {
    test('should submit topWallet transaction using KMS', async () => {
      // Verify KMS wallet is available
      const kmsAddress = AdminWallet.addresses.find(addr => AdminWallet.isKMSWallet(addr))
      expect(kmsAddress).toBeDefined()

      // Use a fresh address that needs topping (topWallet returns false if address already has enough balance)
      const recipientAddress = generateWalletAddress()

      // Submit transaction - topWallet can return false if transaction would revert
      // (e.g., if address already has sufficient balance)
      const receipt = await AdminWallet.topWallet(recipientAddress)

      // Verify receipt is valid
      expect(receipt).toBeDefined()
      expect(receipt.transactionHash).toBeDefined()
      expect(receipt.blockNumber).toBeDefined()
      expect(receipt.status).toBe(true)

      // Verify the transaction was sent from a KMS address
      const tx = await AdminWallet.publicClient
        .getTransaction({ hash: receipt.transactionHash })
        .then(transaction => ({ ...transaction, value: transaction.value.toString() }))
      const usedKMSAddress = tx.from.toLowerCase()

      expect(AdminWallet.isKMSWallet(usedKMSAddress)).toBe(true)
      if (!useRealKMS) expect(signTransaction).toHaveBeenCalled()

      console.log('Transaction submitted using KMS:', {
        txHash: receipt.transactionHash,
        from: usedKMSAddress,
        to: recipientAddress,
        blockNumber: receipt.blockNumber
      })
    }, 60000) // 60 second timeout for KMS operations

    test('should submit whitelist transaction using KMS', async () => {
      const userAddress = generateWalletAddress()
      const did = 'did:gd:test-' + Math.random().toString(36).substring(7)

      let txHash = null

      const receipt = await AdminWallet.whitelistUser(userAddress, did)

      expect(receipt).toBeDefined()
      expect(receipt.status).toBe(true)
      expect(receipt.transactionHash).toBeDefined()
      expect(await AdminWallet.isVerified(userAddress)).toBe(true)
      if (receipt.transactionHash) {
        txHash = receipt.transactionHash

        // Verify the transaction was sent from a KMS address
        const tx = await AdminWallet.publicClient
          .getTransaction({ hash: txHash })
          .then(transaction => ({ ...transaction, value: transaction.value.toString() }))
        const fromAddress = tx.from.toLowerCase()

        expect(AdminWallet.isKMSWallet(fromAddress)).toBe(true)
        console.log('Whitelist transaction submitted using KMS:', {
          txHash,
          from: fromAddress,
          userAddress,
          did
        })
      }
    }, 60000)

    test('should handle multiple KMS transactions in sequence', async () => {
      const addresses = [generateWalletAddress(), generateWalletAddress(), generateWalletAddress()]

      const receipts = []

      for (const address of addresses) {
        const receipt = await AdminWallet.topWallet(address)
        receipts.push(receipt)
        expect(receipt.transactionHash).toBeDefined()
      }

      // Verify all transactions were from KMS addresses
      for (const receipt of receipts) {
        const tx = await AdminWallet.publicClient
          .getTransaction({ hash: receipt.transactionHash })
          .then(transaction => ({ ...transaction, value: transaction.value.toString() }))
        const fromAddress = tx.from.toLowerCase()
        expect(AdminWallet.isKMSWallet(fromAddress)).toBe(true)
      }

      console.log('Multiple KMS transactions completed:', {
        count: receipts.length,
        txHashes: receipts.map(r => r.transactionHash)
      })
    }, 120000) // 2 minute timeout for multiple transactions
  })

  describe('KMS Wallet Information', () => {
    test('should provide KMS key information for addresses', async () => {
      const kmsAddresses = AdminWallet.addresses.filter(addr => AdminWallet.isKMSWallet(addr))

      expect(kmsAddresses.length).toBeGreaterThan(0)

      kmsAddresses.forEach(address => {
        const wallet = AdminWallet.wallets[address.toLowerCase()]
        const keyId = AdminWallet.kmsWallet.getKeyId(address)

        expect(keyId).toBeDefined()
        expect(keyId).toBe(wallet.kmsKeyId)
        console.log('KMS wallet info:', {
          address,
          keyId,
          region: AdminWallet.kmsWallet.getRegion(address)
        })
      })
    })

    test('should list all KMS addresses', async () => {
      const kmsAddresses = AdminWallet.kmsWallet.getAddresses()

      expect(kmsAddresses).toBeDefined()
      expect(Array.isArray(kmsAddresses)).toBe(true)
      expect(kmsAddresses.length).toBeGreaterThan(0)

      console.log('All KMS addresses:', kmsAddresses)
    })
  })
})

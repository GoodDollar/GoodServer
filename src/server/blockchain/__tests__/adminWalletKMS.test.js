// Mock MongoDB connection to prevent database connection during tests
// This must be done before any imports that might trigger MongoDB connection
// Even when enableMongoLock is false, queueMongo is still imported, which triggers MongoDB connection
// Uses the shared mock from src/server/db/__mocks__/mongo-db.js
jest.mock('../../db/mongo-db')

import Web3 from 'web3'
import AdminWallet from '../AdminWallet'
import conf from '../../server.config'

const web3 = new Web3()
const generateWalletAddress = () => web3.eth.accounts.create().address

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
 * Tests will be skipped if KMS is not configured.
 */
describe('AdminWallet KMS Transaction Submission', () => {
  const isKMSConfigured = () => {
    const kmsKeyIds = conf.kmsKeyIds
    return kmsKeyIds && kmsKeyIds.trim().length > 0
  }

  beforeAll(async () => {
    await AdminWallet.ready
  })

  describe('KMS Configuration', () => {
    test('should detect if KMS is configured', () => {
      const configured = isKMSConfigured()
      if (configured) {
        console.log('KMS is configured with key IDs:', conf.kmsKeyIds)
      } else {
        console.log('KMS is not configured. Set KMS_KEY_IDS env var to enable KMS tests.')
      }
      // This test always passes - it's just for information
      expect(typeof configured).toBe('boolean')
    })

    test('should have KMS wallet initialized if KMS is configured', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      expect(AdminWallet.kmsWallet).toBeDefined()
      expect(AdminWallet.kmsWallet).not.toBeNull()
    })

    test('should have KMS addresses if KMS is configured', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      expect(AdminWallet.addresses).toBeDefined()
      expect(AdminWallet.addresses.length).toBeGreaterThan(0)

      // Check if at least one address is a KMS wallet
      const hasKMSAddress = AdminWallet.addresses.some(addr => AdminWallet.isKMSWallet(addr))
      expect(hasKMSAddress).toBe(true)
    })

    test('should identify KMS wallet addresses correctly', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const kmsAddresses = AdminWallet.addresses.filter(addr => AdminWallet.isKMSWallet(addr))

      expect(kmsAddresses.length).toBeGreaterThan(0)

      // Verify each KMS address has a key ID
      kmsAddresses.forEach(address => {
        const wallet = AdminWallet.wallets[address]
        expect(wallet).toBeDefined()
        expect(wallet.isKMS).toBe(true)
        expect(wallet.kmsKeyId).toBeDefined()
        expect(wallet.kmsKeyId).not.toBeNull()
      })
    })
  })

  describe('KMS Transaction Submission', () => {
    test('should submit topWallet transaction using KMS', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const recipientAddress = '0x5D2720B76BBcC2d4F77600C4C9D392bB59a0b0E0'
      let usedKMSAddress = null

      // Find a KMS address to use
      const kmsAddress = AdminWallet.addresses.find(addr => AdminWallet.isKMSWallet(addr))

      expect(kmsAddress).toBeDefined()

      // Submit transaction
      const receipt = await AdminWallet.topWallet(recipientAddress)

      expect(receipt).toBeDefined()
      expect(receipt.transactionHash).toBeDefined()
      expect(receipt.blockNumber).toBeDefined()
      expect(receipt.status).toBe(true)

      // Verify the transaction was sent from a KMS address
      const tx = await AdminWallet.web3.eth.getTransaction(receipt.transactionHash)
      usedKMSAddress = tx.from.toLowerCase()

      expect(AdminWallet.isKMSWallet(usedKMSAddress)).toBe(true)
      console.log('Transaction submitted using KMS:', {
        txHash: receipt.transactionHash,
        from: usedKMSAddress,
        to: recipientAddress,
        blockNumber: receipt.blockNumber
      })
    }, 60000) // 60 second timeout for KMS operations

    test('should submit whitelist transaction using KMS', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const userAddress = generateWalletAddress()
      const did = 'did:gd:test-' + Math.random().toString(36).substring(7)

      let txHash = null

      const receipt = await AdminWallet.whitelistUser(userAddress, did)

      expect(receipt).toBeDefined()
      if (receipt.transactionHash) {
        txHash = receipt.transactionHash

        // Verify the transaction was sent from a KMS address
        const tx = await AdminWallet.web3.eth.getTransaction(txHash)
        const fromAddress = tx.from.toLowerCase()

        expect(AdminWallet.isKMSWallet(fromAddress)).toBe(true)
        console.log('Whitelist transaction submitted using KMS:', {
          txHash,
          from: fromAddress,
          userAddress,
          did
        })
      }

      // Verify user is whitelisted
      const isVerified = await AdminWallet.isVerified(userAddress)
      expect(isVerified).toBe(true)
    }, 60000)

    test('should submit custom transaction using KMS via sendTransaction', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const recipientAddress = '0x5D2720B76BBcC2d4F77600C4C9D392bB59a0b0E0'
      let txHash = null

      // Native ETH transfer
      // Amount of ETH to send (0.001 ETH)
      const transferAmount = AdminWallet.web3.utils.toWei('0.001', 'ether')

      // Create a transaction object that mimics a contract method
      // but represents a simple ETH transfer (empty data, recipient as "to" address)
      const transaction = {
        encodeABI: () => '0x', // Empty data for native ETH transfer
        estimateGas: async () => 21000, // Standard gas for ETH transfer
        send: params => {
          // This won't be used for KMS, but required for the interface
          return AdminWallet.web3.eth.sendTransaction({
            from: params.from,
            to: recipientAddress,
            value: transferAmount,
            gas: params.gas,
            gasPrice: params.gasPrice,
            maxFeePerGas: params.maxFeePerGas,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas,
            nonce: params.nonce,
            chainId: params.chainId
          })
        },
        _parent: {
          _address: recipientAddress,
          options: { address: recipientAddress }
        },
        value: transferAmount
      }

      const receipt = await AdminWallet.sendTransaction(
        transaction,
        {
          onTransactionHash: hash => {
            txHash = hash
            console.log('Transaction hash received:', hash)
          }
        },
        undefined, // use default gas estimation
        true, // retry on error
        null // use default logger
      )

      expect(receipt).toBeDefined()
      expect(receipt.transactionHash).toBeDefined()
      expect(txHash).toBe(receipt.transactionHash)

      // Verify the transaction was sent from a KMS address
      const tx = await AdminWallet.web3.eth.getTransaction(receipt.transactionHash)
      const fromAddress = tx.from.toLowerCase()

      expect(AdminWallet.isKMSWallet(fromAddress)).toBe(true)

      // Verify the transaction included the value (ETH sent)
      expect(tx.value).toBe(transferAmount)

      // Verify it's a native transfer (no data)
      expect(tx.input).toBe('0x' || tx.data === '0x')

      console.log('Native ETH transfer submitted using KMS:', {
        txHash: receipt.transactionHash,
        from: fromAddress,
        to: recipientAddress,
        value: transferAmount,
        valueInEth: AdminWallet.web3.utils.fromWei(transferAmount, 'ether')
      })
    }, 60000)

    test('should handle multiple KMS transactions in sequence', async () => {
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const addresses = [generateWalletAddress(), generateWalletAddress(), generateWalletAddress()]

      const receipts = []

      for (const address of addresses) {
        const receipt = await AdminWallet.topWallet(address)
        receipts.push(receipt)
        expect(receipt.transactionHash).toBeDefined()
      }

      // Verify all transactions were from KMS addresses
      for (const receipt of receipts) {
        const tx = await AdminWallet.web3.eth.getTransaction(receipt.transactionHash)
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
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const kmsAddresses = AdminWallet.addresses.filter(addr => AdminWallet.isKMSWallet(addr))

      expect(kmsAddresses.length).toBeGreaterThan(0)

      kmsAddresses.forEach(address => {
        const wallet = AdminWallet.wallets[address]
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
      if (!isKMSConfigured()) {
        console.log('Skipping: KMS not configured')
        return
      }

      const kmsAddresses = AdminWallet.kmsWallet.getAddresses()

      expect(kmsAddresses).toBeDefined()
      expect(Array.isArray(kmsAddresses)).toBe(true)
      expect(kmsAddresses.length).toBeGreaterThan(0)

      console.log('All KMS addresses:', kmsAddresses)
    })
  })
})

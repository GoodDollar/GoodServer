// @flow
import {
  getEthereumAddress,
  signTransaction as kmsSignTransaction,
  signMessage as kmsSignMessage,
  getPublicKey,
  importKMSKey
} from 'kms-ethereum-signing'
import logger from '../../imports/logger'

const log = logger.child({ from: 'KMSWallet' })

/**
 * KMS Wallet Adapter
 * Wraps eth-kms-signer functionality for use with Web3Wallet
 */
export class KMSWallet {
  kmsKeys: Map<string, { keyId: string, address: string, region?: string }>
  region: ?string

  constructor(region?: string) {
    this.kmsKeys = new Map()
    this.region = region || process.env.AWS_REGION
  }

  /**
   * Initialize KMS wallet with key IDs
   * @param keyIds - Array of KMS key IDs or aliases
   * @returns Promise resolving to array of addresses
   */
  async initialize(keyIds: string[]): Promise<string[]> {
    const addresses = []

    for (const keyId of keyIds) {
      try {
        const address = await getEthereumAddress(keyId, this.region)
        this.kmsKeys.set(address.toLowerCase(), {
          keyId,
          address,
          region: this.region
        })
        addresses.push(address)
        log.info('KMS wallet initialized', { keyId, address })
      } catch (error) {
        log.error('Failed to initialize KMS key', { keyId, error: error.message })
        throw error
      }
    }

    return addresses
  }

  /**
   * Get KMS key ID for an address
   * @param address - Ethereum address
   * @returns KMS key ID or null
   */
  getKeyId(address: string): ?string {
    const keyInfo = this.kmsKeys.get(address.toLowerCase())
    return keyInfo ? keyInfo.keyId : null
  }

  /**
   * Get region for an address
   * @param address - Ethereum address
   * @returns AWS region or null
   */
  getRegion(address: string): ?string {
    const keyInfo = this.kmsKeys.get(address.toLowerCase())
    return keyInfo ? keyInfo.region : null
  }

  /**
   * Check if address is managed by KMS
   * @param address - Ethereum address
   * @returns boolean
   */
  hasAddress(address: string): boolean {
    return this.kmsKeys.has(address.toLowerCase())
  }

  /**
   * Get all addresses managed by KMS
   * @returns Array of addresses
   */
  getAddresses(): string[] {
    return Array.from(this.kmsKeys.values()).map(k => k.address)
  }

  /**
   * Sign a transaction using KMS
   * @param address - Ethereum address to sign with
   * @param transaction - Transaction parameters
   * @returns Signed transaction hex string
   */
  async signTransaction(
    address: string,
    transaction: {
      to: string,
      value?: string,
      data?: string,
      nonce?: number,
      gasLimit?: string,
      gasPrice?: string,
      maxFeePerGas?: string,
      maxPriorityFeePerGas?: string,
      chainId: number,
      rpcUrl?: string
    }
  ): Promise<string> {
    const keyId = this.getKeyId(address)
    if (!keyId) {
      throw new Error(`No KMS key found for address: ${address}`)
    }

    const region = this.getRegion(address)

    try {
      transaction = {
        ...transaction,
        maxFeePerGas: undefined
      }
      console.log('signTransaction', transaction)
      const signedTx = await kmsSignTransaction(keyId, transaction, region)
      log.debug('Transaction signed with KMS', { address, keyId, chainId: transaction.chainId })
      return signedTx
    } catch (error) {
      log.error('Failed to sign transaction with KMS', {
        address,
        keyId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Sign a message using KMS
   * @param address - Ethereum address to sign with
   * @param message - Message to sign
   * @returns Signature hex string
   */
  async signMessage(address: string, message: string): Promise<string> {
    const keyId = this.getKeyId(address)
    if (!keyId) {
      throw new Error(`No KMS key found for address: ${address}`)
    }

    const region = this.getRegion(address)

    try {
      const signature = await kmsSignMessage(keyId, message, region)
      log.debug('Message signed with KMS', { address, keyId })
      return signature
    } catch (error) {
      log.error('Failed to sign message with KMS', {
        address,
        keyId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Import a private key into KMS
   * @param privateKeyHex - Private key in hex format
   * @param aliasName - Alias name for the KMS key
   * @returns Promise resolving to key ID and address
   */
  async importPrivateKey(privateKeyHex: string, aliasName: string): Promise<{ keyId: string, address: string }> {
    try {
      const result = await importKMSKey(privateKeyHex, aliasName, this.region)

      const address = await getEthereumAddress(result.keyId, this.region)

      this.kmsKeys.set(address.toLowerCase(), {
        keyId: result.keyId,
        address,
        region: this.region
      })

      log.info('Private key imported to KMS', {
        aliasName,
        keyId: result.keyId,
        address
      })

      return { keyId: result.keyId, address }
    } catch (error) {
      log.error('Failed to import private key to KMS', {
        aliasName,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Get public key for an address
   * @param address - Ethereum address
   * @returns Public key hex string
   */
  async getPublicKey(address: string): Promise<string> {
    const keyId = this.getKeyId(address)
    if (!keyId) {
      throw new Error(`No KMS key found for address: ${address}`)
    }

    const region = this.getRegion(address)
    return getPublicKey(keyId, region)
  }
}

import { once } from 'lodash'

// Core interfaces
import { createAgent } from '@veramo/core'

// Core identity manager plugin
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager'

// Ethr did identity provider
import { KeyDIDProvider } from '@veramo/did-provider-key'

// Core key manager plugin
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager'

// Custom key management system for RN
import { KeyManagementSystem } from '@veramo/kms-local'

// W3C Verifiable Credential plugin
import { CredentialPlugin } from '@veramo/credential-w3c'

// Custom resolvers
import { DIDResolverPlugin } from '@veramo/did-resolver'
import { Resolver } from 'did-resolver'
import { getResolver as keyDidResolver } from 'key-did-resolver'

import MultiWallet from '../blockchain/MultiWallet'

const getSeedFromPrivateKey = (privateKeyHex, bytes = 64) => {
  let seed = privateKeyHex[0]
  const hexChars = 2 * bytes

  for (let i = 1; i < privateKeyHex.length; i++) {
    if (seed.length >= hexChars) {
      break
    }

    seed += privateKeyHex[i]
  }

  return seed.substring(0, hexChars)
}

export const getSubjectId = walletAddress => `did:ethr:${walletAddress}`

export const getAgent = once(async () => {
  const agent = createAgent({
    plugins: [
      new KeyManager({
        store: new MemoryKeyStore(),
        kms: {
          local: new KeyManagementSystem(new MemoryPrivateKeyStore())
        }
      }),
      new DIDManager({
        store: new MemoryDIDStore(),
        defaultProvider: 'did:key',
        providers: {
          'did:key': new KeyDIDProvider({
            defaultKms: 'local'
          })
        }
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...keyDidResolver()
        })
      }),
      new CredentialPlugin()
    ]
  })

  await MultiWallet.ready

  const { wallet } = MultiWallet.mainWallet.web3.eth.accounts
  const privateKeyHex = getSeedFromPrivateKey(
    wallet.map(({ privateKey }) => privateKey.toLowerCase().replace('0x', ''))
  )

  await agent.didManagerCreate({ alias: 'default', options: { privateKeyHex } })
  return agent
})

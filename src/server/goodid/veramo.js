import { once } from 'lodash'

import MultiWallet from '../blockchain/MultiWallet'

export const Credential = Object.freeze({
  Location: 'VerifiableLocationCredential',
  Identity: 'VerifiableIdentityCredential',
  Gender: 'VerifiableGenderCredential',
  Age: 'VerifiableAgeCredential'
})

export const getSubjectId = walletAddress => `did:ethr:${walletAddress}`

export const getAgent = once(async () => {
  const [
    { createAgent },
    { DIDManager, MemoryDIDStore },
    { KeyDIDProvider },
    { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore },
    { KeyManagementSystem },
    { CredentialPlugin },
    { DIDResolverPlugin },
    { Resolver },
    { getResolver: keyDidResolver }
  ] = await Promise.all([
    import('@veramo/core'),
    import('@veramo/did-manager'),
    import('@veramo/did-provider-key'),
    import('@veramo/key-manager'),
    import('@veramo/kms-local'),
    import('@veramo/credential-w3c'),
    import('@veramo/did-resolver'),
    import('did-resolver'),
    import('key-did-resolver')
  ])

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

  const privateKeyHex = Array(2)
    .fill(null)
    .map((_, index) => wallet[index])
    .map(({ privateKey }) => privateKey.toLowerCase().replace('0x', ''))
    .join('')

  await agent.didManagerCreate({ alias: 'default', options: { privateKeyHex } })
  return agent
})

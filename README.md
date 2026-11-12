# GoodDollar API Server

We use
[<img valign="middle" src="https://www.datocms-assets.com/31049/1618983297-powered-by-vercel.svg?raw=true&sanitize=1" width="100px"/>](https://vercel.com/?utm_source=gooddollar&utm_campaign=oss)

[![Build Status](https://travis-ci.com/GoodDollar/GoodServer.svg?branch=master)](https://travis-ci.com/GoodDollar/GoodServer)
[![Coverage Status](https://coveralls.io/repos/github/GoodDollar/GoodServer/badge.svg?branch=master)](https://coveralls.io/github/GoodDollar/GoodServer?branch=master)

## Setup

- copy env.example to .env
- choose network kovan/truffle (see below how to setup local truffle node)
- fill the mnemonic that was used to deploy contracts

## Blockchain Clients

- Admin wallets use viem clients from `@goodwidget/core/viemFallbackClient`.
- Configured comma-separated HTTP RPCs are tried first, followed by Chainlist RPCs. RPC discovery is cached in memory; background endpoint ranking is disabled.
- Use `wallet.publicClient` for RPC reads, `contract.read.method([args])` for contract reads, and `wallet.contractTransaction(contract, 'method', [args])` with `wallet.sendTransaction(...)` for queued writes. KMS signing remains supported.
- Wallet transaction receipts retain boolean `status` and numeric `blockNumber`; direct viem results use bigint quantities and `success`/`reverted` statuses.
- Run isolated wallet tests with `npx jest src/server/blockchain/__tests__/viemWallet.test.js --runInBand --config '{"testEnvironment":"node","transform":{"^.+\\.js$":"babel-jest"}}'`.

## Celo Fork Tests

The admin-wallet integration tests start a local Anvil node that forks Celo mainnet (chain ID `42220`) at an explicitly pinned block, using the existing `development-celo` GoodDollar deployment. Install Foundry and ensure `anvil` is on `PATH`. No local contract deployment or changes to server configuration are needed.

Both `adminWallet.test.js` and `adminWalletKMS.test.js` run as part of the regular command:

```sh
pnpm run test
```

Each suite starts and stops its own Anvil node unless `CELO_FORK_RPC_URL` points to an existing local node. Regular runs default to `https://forno.celo.org` at block `82495167`; override these with `CELO_ARCHIVE_RPC_URL` and `CELO_FORK_BLOCK_NUMBER`. No latest-block fallback is used. Network access to the archive RPC is required.

The regular KMS suite uses the real KMS wallet adapter but mocks the AWS signing boundary with an ephemeral software signer. It submits and verifies real signed transactions on the local fork without AWS credentials. This covers the adapter and transaction pipeline, not the AWS service itself.

Choose a block where the development contracts exist and the configured owner has its admin role. The archive endpoint must support historical account, code, and storage reads at that block. Keep RPC credentials out of source control.

Setup verifies the chain, deployed contract bytecode, and admin role before modifying local state. It funds accounts with `anvil_setBalance`, then uses `anvil_impersonateAccount` for `0x2CeADe86A04e474F3cf9BD87208514d818010627` to call `AdminWallet.addAdmins`. Impersonation is stopped even if provisioning fails. Set `CELO_FORK_OWNER` to override that account; it must hold `DEFAULT_ADMIN_ROLE` on the development AdminWallet at the chosen block. Normal test transactions still use a fresh local signing key.

All wallet clients, including the wallet's auxiliary mainnet clients, are pinned to local Anvil with no public-RPC fallback. Test wallets estimate transaction fees from the fork instead of using the server's fixed fee caps. MongoDB and Slack are mocked; the real in-memory nonce queue is used. Each suite takes a local snapshot before setup and restores it afterward. Reads may reach the archive RPC through Anvil; test transactions and state changes remain local.

To exercise real AWS KMS signing on the same fork, configure `KMS_KEY_IDS` or `KMS_KEYS_TAG`, `AWS_REGION`, and AWS credentials, then run:

```sh
CELO_FORK_REAL_KMS=true pnpm run test src/server/blockchain/__tests__/adminWalletKMS.test.js
```

Real-KMS mode fails if keys or credentials are missing; it never falls back to the local signer.

KMS addresses are funded and granted admin access using the same impersonated setup.

## Local Node

- clone @gooddollar/goodcontracts
- run `truffle develop`
- in console type `migrate --reset`

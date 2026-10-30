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
- Local HTTP nodes and configured WebSocket connections use explicit viem transports.
- Use `wallet.publicClient` for RPC reads, `contract.read.method([args])` for contract reads, and `wallet.contractTransaction(contract, 'method', [args])` with `wallet.sendTransaction(...)` for queued writes. KMS signing remains supported.
- Wallet transaction receipts retain boolean `status` and numeric `blockNumber`; direct viem results use bigint quantities and `success`/`reverted` statuses.
- Run isolated wallet tests with `npx jest src/server/blockchain/__tests__/viemWallet.test.js --runInBand --config '{"testEnvironment":"node","transform":{"^.+\\.js$":"babel-jest"}}'`.

## Local Node

- clone @gooddollar/goodcontracts
- run `truffle develop`
- in console type `migrate --reset`

# Security alert triage (2026-11-15)

Scope: open GitHub **Dependabot** alerts (361) and **code scanning** alerts (47) for `GoodDollar/GoodServer`,
evaluated against `switch-to-viem` @ `20346368` (after #600 and #601).

GitHub raises these against the default branch, so most are stale for this branch. Relevance was checked
mechanically: each Dependabot alert's vulnerable range against **every version in `pnpm-lock.yaml`**, and each
code-scanning alert against the code CodeQL analysed (`git show <alert commit>:<path>`) versus today's code.

## Summary

| Source | Open | Gone / fixed on this branch | Still relevant |
|---|---|---|---|
| Dependabot | 361 | 309 (107 package no longer in lockfile, 202 already at a patched version) | **52 alerts / 23 packages** (2 critical, 20 high, 24 medium, 6 low) |
| Code scanning | 47 | ~28 (quality alerts already fixed or in removed code, `profileSignature` bypass removed) | **6 worth acting on** (rest are false positives / low value) |

Alerts will auto-close on GitHub as this branch reaches the default branch and the lockfile changes.

---

## Status (updated after fixes on `security/alert-triage`)

| Item | Decision / result |
|---|---|
| Rate limit `/auth/eth`, `/auth/fv`, `/auth/fv2` | **Fixed** (30/min per IP; test added). Alerts #37, #77 |
| `aws-ses.js` type validation | **Fixed** (tests added). Alert #19 |
| `visitorsCounter` | **Fixed** (`Map`). Alert #24 |
| Offerwall endpoint | **Removed** with `offerwallSecret` config and `transferWalletGoodDollars`. Alert #87 (MD5) and the replay issue no longer apply |
| NoSQL operator injection | **Fixed** with type guards in the storage layer (tests added); global `sanitizeFilter` rejected because the code legitimately uses `$in`/`$lte`/... Alerts #3, #48, #49, #72 (CodeQL may keep them open: it may not recognise the custom guard) |
| `lint-staged` 17, `nodemon` 3 (+ pin of the 2.x range) | **Fixed**. Dependabot #230 (micromatch), #378 (yaml), #182 (semver) |
| `@gooddollar/kms-ethereum-signing` | **Out of scope here**: to be fixed in the package itself |
| `@axelar-network/axelarjs-sdk` | Not done in this branch |
| `@sentry/node` upgrade | Dropped |

Dependabot alerts still relevant after these fixes: **49** (was 52).

## 1. Dependabot: still relevant

### 1a. Root cause: `@gooddollar/kms-ethereum-signing` -> `web3` 1.x -> `web3-bzz` -> `swarm-js` (13 packages, runtime)

This single dependency accounts for most of the runtime exposure, including both **critical** alerts.

| Package (installed) | Sev | Alerts | Patched in |
|---|---|---|---|
| tar 4.4.19 | critical | #530 #516 #515 #514 #513 #492 #364 #362 #336 #323 #321 #319 #213 | 6.2.1 / 7.5.x |
| form-data 2.3.3 | critical | #490 #285 | 2.5.4 |
| qs 6.5.5 | medium | #554 #312 | 6.14.1 |
| tough-cookie 2.5.0 | medium | #181 | 4.1.3 |
| decode-uri-component 0.2.2 | high | #604 #549 | 0.5.0 |
| ws 3.3.3 | high | #484 #219 | 5.2.4 |
| bn.js 4.11.6 | medium | #346 | 4.12.3 |
| uuid 3.4.0 / 9.0.1 | medium | #461 | 11.1.1 (only exploitable when a caller passes a `buf` argument) |
| request 2.88.2 | medium | #164 | **no patch (deprecated)** |
| web3-core-subscriptions 1.10.4 | low | #292 | no patch |

How the library is used: `KMSWallet.js` imports only `getEthereumAddress`, `signTransaction`, `signMessage`,
`getPublicKey`, `importKMSKey`. Inside the package, `web3` is used for `keccak256` / `toChecksumAddress`
(`getEthereumAddress`), an optional nonce lookup (`signTransaction` with an RPC URL), and `sendSignedTransaction`
in `core/submit.js`, which this repo never calls. `swarm-js` (the source of tar/request/qs/form-data/...) is
pulled in by `web3-bzz`, which is dead weight here.

**Suggested fixes (pick one):**

1. **Recommended: replace the library with an in-repo viem implementation** (about 150 lines). The repo already
   depends on `viem` and `@aws-sdk/client-kms`:
   - address: `keccak256` of the KMS public key -> `getAddress` (viem);
   - signing: `serializeTransaction` (viem) -> hash -> `kms.sign` (ECDSA_SHA_256, MESSAGE_TYPE DIGEST) -> DER
     decode -> low-S normalise and recover `v` -> `serializeTransaction` with the signature;
   - `importKMSKey` is only used by key provisioning (`KMSWallet.js:241`); keep the package as a dev/ops-only
     dependency or port it too.
   This removes `web3` and 11 of the 13 packages above in one step, and unblocks the 28 remaining deprecated
   transitive packages.
2. **Interim: neutralise the unused `web3` sub-packages** with `overrides` pointing `web3-bzz` and `web3-shh` at
   tiny local stubs (`link:./stubs/web3-bzz`). `web3` calls `new Bzz(provider)` in its constructor, so the stub
   needs a minimal class. Plus same-major pins: `bn.js@4 -> 4.12.3`. Low effort, hacky, needs a test that
   instantiates `getEthereumAddress` and `signTransaction`.
3. **Not recommended:** pinning `tar@4 -> 6`, `ws@3 -> 5`, `tough-cookie@2 -> 4` via overrides. These are major
   jumps in packages with no maintained successor for `request`, so `request` stays vulnerable anyway.

### 1b. Root cause: `@axelar-network/axelarjs-sdk` (runtime)

| Package | Sev | Alerts | Notes |
|---|---|---|---|
| protobufjs 6.11.6 (via `axelarjs-types`) | high | #489 #485 #459 #455 #454 #452 #451 #450 #449 #448 | patched 7.5.x; 0.22.0 of the SDK does not change this |
| uuid 8.3.2 | medium | (see #461) | `buf` argument only |
| elliptic 6.6.1 (via ethers 5) | low | #316 | no patch available |

The SDK is used for **one endpoint**: `AxelarQueryAPI.estimateGasFee` in `GET /bridge/estimatefees`
(`login-middleware.js:266`). **Suggested fix:** replace those two calls with a direct HTTPS request to Axelar's
gas-fee estimation API (a fixed, known host) and drop the SDK. That removes protobufjs 6, the Cosmos/Solana/Sui
client trees and their deprecated packages.

### 1c. Other runtime

| Package | Sev | Alerts | Root | Fix |
|---|---|---|---|---|
| cookie 0.4.2 | low | #238 | `@sentry/node` 5.30.0 | upgrade `@sentry/node` to a current major (v5 is end-of-life); needs a quick check of `Sentry.init` usage |

### 1d. Dev-only (do not ship in the production bundle)

| Package | Sev | Alerts | Root | Fix |
|---|---|---|---|---|
| markdown-it 12.3.2, linkify-it 3.0.3, bootstrap 3.4.1, esbuild 0.16.17 | high / medium | #596 #595 #570 #491, #524, #293 #291, #255 | `apidoc` 0.53.1 | apidoc 1.2.0 still pins markdown-it 12 / bootstrap 3, so upgrading does not help; either accept (docs tooling only, input is the repo's own comments) or replace the docs generator |
| vue-template-compiler 2.7.16 | medium | #222 | `documentation` 14.0.1 | no patch; accept or drop the `documentation` script |
| micromatch 4.0.5, yaml 2.3.1 | medium | #230, #378 | `lint-staged` 13.3.0 | upgrade `lint-staged` to 15+/16 |
| semver 7.0.0 | high | #182 | `nodemon` 2.0.22 -> `simple-update-notifier` | upgrade `nodemon` to 3.x (also used by `nodemon-webpack-plugin`) or override `semver@7.0.0 -> 7.7.x` (same major) |
| cookie 0.3.1, send 0.16.2 | low | #238, #234 | `mock-express-response` 0.2.2 | override both to same-major patched versions, or replace with `node-mocks-http` |
| deepmerge 4.3.1 | low | #603 | jest / torus | no patch |

Quick wins (about 10 minutes, all dev-only, verified by a test run): `lint-staged` and `nodemon` upgrades.

---

## 2. Code scanning

Alert line numbers refer to old commits; mapped to current code below.

### Worth acting on

| # | Rule | Where (current) | Verdict | Suggested fix |
|---|---|---|---|---|
| 37, 77 | `js/missing-rate-limiting` (high) | `login-middleware.js`: `POST /auth/eth`, `/auth/fv`, `/auth/fv2` have **no** `requestRateLimiter`; most other routes use it | **Relevant** | add `requestRateLimiter(10, 1)` (or tighter) as middleware, like `/bridge/estimatefees`; `/auth/*` is the credential-verification surface |
| 19 | `js/comparison-between-incompatible-types` | `aws-ses.js:54-57`: `!typeof x === 'string'` and `typeof !x === 'number'` | **Real bug** (validation of `firstname`/`code` types never works as written) | `typeof templateData.firstname !== 'string'` and `typeof templateData.code !== 'string' && typeof templateData.code !== 'number'`; note callers pass `code` as a string |
| 24 | `js/remote-property-injection` (high) | `verificationAPI.js` ~1065-1086: `visitorsCounter[visitorId]` on a plain `{}` with a client-supplied fingerprint id | Relevant (low impact: `__proto__`/`constructor` keys corrupt the counter) | `const visitorsCounter = new Map()` with `.get/.set` |
| 87 | `js/weak-cryptographic-algorithm` (high) | `verificationAPI.js` ~1168 `/verify/offerwall`: MD5 over `secret.user_id.value.token` | Relevant but protocol-bound | MD5 is the provider's signature scheme; mitigate: compare with `crypto.timingSafeEqual`, ask the provider for HMAC-SHA256, and persist the used-token set (see below) |
| (new) | replay protection | same endpoint: `payouts = new Set()` in memory | **Relevant**: resets on restart, not shared across instances, so a replayed signed request can pay twice | store paid tokens in Mongo with a unique index |
| 3, 48, 49, 72 | `js/sql-injection` (NoSQL) (high) | `user-privat-provider.js`: `getByIdentifier`, `getUsersByEmail`, `getUsersByMobile`, `getByIdentifierHash` ($or), `updateUser` | Low: reachable from `adminAuthenticate` routes (`/admin/user/get`, `/admin/user/delete`) with `body.identifierHash`/`body.identifier` passed through unchecked; elsewhere the input is JWT-derived or hashed | `mongoose.set("sanitizeFilter", true)` globally, or `typeof x === "string"` guards in the admin handlers |

### Low value or false positives

| # | Rule | Verdict |
|---|---|---|
| 23, 42, 82, 83, 85, 88-93 | `js/log-injection` (11) | Logger is structured JSON (pino), which escapes newlines, so log forging is not possible. Optionally strip `\r\n` from values logged as plain strings. |
| 64 | `js/user-controlled-bypass` (goodid certificate verify) | False positive: `if (!certificate) throw` is input validation; route is rate limited. |
| 25 | `js/user-controlled-bypass` (profile signature) | Code removed (`profilePublickey` is gone). |
| 66 | `js/shell-command-injection-from-environment` (`scripts/docs.js`) | Dev script, fixed command strings; accept. |
| 47 | `js/overwritten-property` (`webpack.dev.config.js`) | Dev config duplicate key; harmless, fix when touching the file. |
| 20 | `js/syntax-error` | `flow-typed` stub; delete the stub. |
| 17x `unused-local-variable`, 2x `useless-assignment`, 3x `trivial-conditional` | Quality | In `src/` these are already clean (`pnpm lint` has 0 warnings); remaining ones are in `scripts/` and `flow-typed/`. |

---

## 3. Suggested order

1. Add rate limiting to `/auth/eth`, `/auth/fv`, `/auth/fv2` (small, closes 2 high alerts).
2. Fix the `aws-ses.js` validation bug (tiny).
3. Persist offerwall payout tokens + `timingSafeEqual` (prevents double payout).
4. Replace `@gooddollar/kms-ethereum-signing` with a viem implementation (closes both critical alerts and ~13 packages).
5. Replace `axelarjs-sdk` with a direct API call (closes 10 high protobufjs alerts).
6. `@sentry/node` upgrade; `lint-staged` / `nodemon` upgrades; `visitorsCounter` -> `Map`; `sanitizeFilter`.

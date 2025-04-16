// @flow
import crypto from 'crypto'
import { Router } from 'express'
import passport from 'passport'
import { get, defaults, memoize, omit } from 'lodash'
import { sha3, keccak256 } from 'web3-utils'
import web3Abi from 'web3-eth-abi'
import requestIp from 'request-ip'
import moment from 'moment'
import type { LoggedUser, StorageAPI, UserRecord, VerificationAPI } from '../../imports/types'
import { default as AdminWallet } from '../blockchain/MultiWallet'
import { findFaucetAbuse, findGDTx } from '../blockchain/explorer'
import { onlyInEnv, wrapAsync } from '../utils/helpers'
import requestRateLimiter, { userRateLimiter } from '../utils/requestRateLimiter'
import OTP from '../../imports/otp'
import conf from '../server.config'
import OnGage from '../crm/ongage'
import { sendTemplateEmail } from '../aws-ses/aws-ses'
import fetch from 'cross-fetch'
import createEnrollmentProcessor from './processor/EnrollmentProcessor.js'
import createIdScanProcessor from './processor/IdScanProcessor'

import { cancelDisposalTask, getDisposalTask } from './cron/taskUtil'
import { recoverPublickey, verifyIdentifier } from '../utils/eth'
import { shouldLogVerificaitonError } from './utils/logger'
import { syncUserEmail } from '../storage/addUserSteps'
import { normalizeIdentifiers } from './utils/utils.js'

import ipcache from '../db/mongo/ipcache-provider.js'
import { DelayedTaskStatus } from '../db/mongo/models/delayed-task.js'

export const deleteFaceId = async (fvSigner, enrollmentIdentifier, user, storage, log) => {
  const { gdAddress } = user
  log.debug('delete face request:', { fvSigner, enrollmentIdentifier, user })
  const processor = createEnrollmentProcessor(storage, log)

  // for v2 identifier - verify that identifier is for the address we are going to whitelist
  await verifyIdentifier(enrollmentIdentifier, gdAddress)

  const { v2Identifier, v1Identifier } = normalizeIdentifiers(enrollmentIdentifier, fvSigner)

  // here we check if wallet was registered using v1 of v2 identifier
  const [isV2, isV1] = await Promise.all([
    processor.isIdentifierExists(v2Identifier),
    v1Identifier && processor.isIdentifierExists(v1Identifier)
  ])

  if (isV2) {
    //in v2 we expect the enrollmentidentifier to be the whole signature, so we cut it down to 42
    await processor.enqueueDisposal(user, v2Identifier, log)
  }

  if (isV1) {
    await processor.enqueueDisposal(user, v1Identifier, log)
  }
}

// try to cache responses from faucet abuse to prevent 500 errors from server
// if same user keep requesting.
const cachedFindFaucetAbuse = memoize(findFaucetAbuse)
const clearMemoizedFaucetAbuse = async () => {
  if (cachedFindFaucetAbuse.cache) {
    cachedFindFaucetAbuse.cache.clear()
    console.log('clearMemoizedFaucetAbuse done')
    return
  }
  console.log('clearMemoizedFaucetAbuse failed')
}
if (conf.env !== 'test') setInterval(clearMemoizedFaucetAbuse, 60 * 60 * 1000) // clear every 1 hour

let faucetAddressBlocked = {}
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const checkMultiIpAccounts = async (account, ip, logger) => {
  const record = await ipcache.updateAndGet(ip.toLowerCase(), account.toLowerCase())
  logger.debug('checkMultiIpAccounts:', { record })
  const { accounts } = record
  if (accounts.length >= 5) {
    logger.debug('checkMultiIpAccounts:', { ip, account, accounts })
    accounts.forEach(addr => (faucetAddressBlocked[addr] = faucetAddressBlocked[addr] || Date.now()))
    return accounts
  }
  if (faucetAddressBlocked[account]) {
    return true
  }
  return false
}

if (conf.env !== 'test')
  setInterval(
    () => {
      let cleared = 0
      Object.keys(faucetAddressBlocked).forEach(addr => {
        if (faucetAddressBlocked[addr] + SEVEN_DAYS <= Date.now()) {
          cleared += 1
          delete faucetAddressBlocked[addr]
        }
      })
      console.log(
        'cleaning faucetAddressBlocked after 7 days. total addresses:',
        Object.keys(faucetAddressBlocked).length,
        'cleared:',
        cleared
      )
    },
    24 * 60 * 60 * 1000
  ) // clear every 1 day (24 hours)

const setup = (app: Router, verifier: VerificationAPI, storage: StorageAPI) => {
  /**
   * @api {delete} /verify/face/:enrollmentIdentifier Enqueue user's face snapshot for disposal since 24h
   * @apiName Dispose Face
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} signature
   *
   * @ignore
   */
  app.delete(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { params, query, log, user } = req
      const { enrollmentIdentifier } = params
      const { fvSigner = '' } = query

      try {
        const authenticationPeriod = await AdminWallet.getAuthenticationPeriod()

        const record = await getDisposalTask(storage, enrollmentIdentifier)
        log.debug('get face disposal task result:', { enrollmentIdentifier, record })
        if (record == null || record.status === DelayedTaskStatus.Complete) {
          return res.json({ success: true, status: DelayedTaskStatus.Complete })
        }
        return res.json({
          success: true,
          status: record.status,
          executeAt: moment(record.createdAt)
            .add(authenticationPeriod + 1, 'days')
            .toISOString()
        })
      } catch (exception) {
        const { message } = exception

        log.error('delete face record failed:', message, exception, { enrollmentIdentifier, fvSigner, user })
        res.status(400).json({ success: false, error: message })
        return
      }
    })
  )

  /**
   * @api {get} /verify/face/:enrollmentIdentifier Checks is face snapshot enqueued for disposal. Return disposal state
   * @apiName Check face disposal state
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   *
   * @ignore
   */
  app.get(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { params, log, user, query } = req
      const { enrollmentIdentifier } = params
      const { fvSigner = '' } = query
      log.debug('check face status request:', { fvSigner, enrollmentIdentifier, user })

      try {
        const { v2Identifier, v1Identifier } = normalizeIdentifiers(enrollmentIdentifier, fvSigner)

        const processor = createEnrollmentProcessor(storage, log)
        const [isDisposingV2, isDisposingV1] = await Promise.all([
          processor.isEnqueuedForDisposal(v2Identifier, log),
          v1Identifier && processor.isEnqueuedForDisposal(v1Identifier, log)
        ])

        res.json({ success: true, isDisposing: !!isDisposingV2 || !!isDisposingV1 })
      } catch (exception) {
        const { message } = exception

        log.error('face record disposing check failed:', message, exception, { enrollmentIdentifier, fvSigner, user })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {post} /verify/face/license Retrieves FaceTec license key for a new enrollment session
   * @apiName Retrieves FaceTec license key text
   * @apiGroup Verification
   *
   * @ignore
   */
  app.post(
    '/verify/face/license/:licenseType',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { log, user, params } = req
      const { licenseType } = params

      log.debug('license face request:', { licenseType, user })

      try {
        if (!conf.zoomProductionMode) {
          throw new Error('Cannot obtain production license running non-production mode.')
        }

        const processor = createEnrollmentProcessor(storage, log)
        const license = await processor.getLicenseKey(licenseType, log)

        res.json({ success: true, license })
      } catch (exception) {
        const { message } = exception
        log.error('getting FaceTec license failed:', message, exception, { user })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {post} /verify/face/session Issues session token for a new enrollment session
   * @apiName Issue enrollment session token
   * @apiGroup Verification
   *
   * @ignore
   */
  app.post(
    '/verify/face/session',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { log, user } = req

      log.debug('session face request:', { user })

      try {
        const processor = createEnrollmentProcessor(storage, log)
        const sessionToken = await processor.issueSessionToken(log)

        res.json({ success: true, sessionToken })
      } catch (exception) {
        const { message } = exception

        log.error('generating enrollment session token failed:', message, exception, { user })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {put} /verify/:enrollmentIdentifier Verify users face
   * @apiName Face Verification
   * @apiGroup Verification
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} sessionId
   *
   * @ignore
   */
  app.put(
    '/verify/face/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, log, params, body } = req
      const { enrollmentIdentifier } = params
      const { chainId, fvSigner = '', ...payload } = body || {} // payload is the facetec data
      const { gdAddress } = user

      log.debug('enroll face request:', { fvSigner, enrollmentIdentifier, chainId, user })

      // checking if request aborted to handle cases when connection is slow
      // and facemap / images were uploaded more that 30sec causing timeout
      if (req.aborted) {
        return
      }

      // user.chainId = chainId || conf.defaultWhitelistChainId

      //currently we force all new users to be marked as registered first on celo
      //this is relevant for the invite rewards
      user.chainId = 42220

      try {
        // for v2 identifier - verify that identifier is for the address we are going to whitelist
        // for v1 this will do nothing
        await verifyIdentifier(enrollmentIdentifier, gdAddress)

        const { v2Identifier, v1Identifier } = normalizeIdentifiers(enrollmentIdentifier, fvSigner)
        const enrollmentProcessor = createEnrollmentProcessor(storage, log)

        // here we check if wallet was registered using v1 of v2 identifier
        const isV1 = !!v1Identifier && (await enrollmentProcessor.isIdentifierExists(v1Identifier))

        try {
          // if v1, we convert to v2
          // delete previous enrollment.
          // once user completes FV it will create a new record under his V2 id. update his lastAuthenticated. and enqueue for disposal
          if (isV1) {
            log.info('v1 identifier found, converting to v2', { v1Identifier, v2Identifier, gdAddress })
            await Promise.all([
              enrollmentProcessor.dispose(v1Identifier, log),
              cancelDisposalTask(storage, v1Identifier)
            ])
          }
          await enrollmentProcessor.validate(user, v2Identifier, payload)
          const wasWhitelisted = await AdminWallet.lastAuthenticated(gdAddress)
          const enrollmentResult = await enrollmentProcessor.enroll(user, v2Identifier, payload, log)

          // fetch duplicate expiration
          if (enrollmentResult.success === false && enrollmentResult.enrollmentResult?.isDuplicate) {
            const dup = enrollmentResult.enrollmentResult.duplicate.identifier
            const authenticationPeriod = await AdminWallet.getAuthenticationPeriod()
            const record = await getDisposalTask(storage, dup)
            const expiration = moment(record?.createdAt || 0)
              .add(authenticationPeriod + 1, 'days')
              .toISOString()
            enrollmentResult.enrollmentResult.duplicate.expiration = expiration
          }
          // log warn if user was whitelisted but unable to pass FV again
          if (wasWhitelisted > 0 && enrollmentResult.success === false) {
            log.warn('user failed to re-authenticate', {
              wasWhitelisted,
              enrollmentResult,
              gdAddress,
              v2Identifier
            })
            if (isV1) {
              //throw error so we de-whitelist user
              throw new Error('User failed to re-authenticate with V1 identifier')
            }
          }
          log.info(wasWhitelisted > 0 && enrollmentResult.success ? 'user re-authenticated' : 'user enrolled', {
            wasWhitelisted,
            enrollmentResult,
            gdAddress,
            v2Identifier
          })
          res.json(enrollmentResult)
        } catch (e) {
          if (isV1) {
            // if we deleted the user record but had an error in whitelisting, then we must revoke his whitelisted status
            // since we might not have his record enrolled
            const isIndexed = await enrollmentProcessor.isIdentifierIndexed(v2Identifier)
            // if new identifier is indexed then dont revoke
            if (!isIndexed) {
              const isWhitelisted = await AdminWallet.isVerified(gdAddress)
              if (isWhitelisted) await AdminWallet.removeWhitelisted(gdAddress)
            }
            log.error('failed converting v1 identifier', e.message, e, { isIndexed, gdAddress })
          }

          throw e
        }
      } catch (exception) {
        const { message } = exception
        const logArgs = ['Face verification error:', message, exception, { enrollmentIdentifier, fvSigner, gdAddress }]

        if (shouldLogVerificaitonError(exception)) {
          log.error(...logArgs)
        } else {
          log.warn(...logArgs)
        }

        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * @api {put} /verify/idscan:enrollmentIdentifier Verify id matches face and does OCR
   * @apiName IDScan
   * @apiGroup IDScanq
   *
   * @apiParam {String} enrollmentIdentifier
   * @apiParam {String} sessionId
   *
   * @ignore
   */
  app.put(
    '/verify/idscan/:enrollmentIdentifier',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const { user, log, params, body } = req
      const { enrollmentIdentifier } = params
      const { ...payload } = body || {} // payload is the facetec data
      const { gdAddress } = user

      log.debug('idscan request:', { user, payloadFields: Object.keys(payload) })

      // checking if request aborted to handle cases when connection is slow
      // and facemap / images were uploaded more that 30sec causing timeout
      if (req.aborted) {
        return
      }

      try {
        // for v2 identifier - verify that identifier is for the address we are going to whitelist
        // for v1 this will do nothing
        await verifyIdentifier(enrollmentIdentifier, gdAddress)

        const { v2Identifier } = normalizeIdentifiers(enrollmentIdentifier)

        const idscanProcessor = createIdScanProcessor(storage, log)

        let { isMatch, scanResultBlob, ...scanResult } = await idscanProcessor.verify(user, v2Identifier, payload)
        scanResult = omit(scanResult, ['externalDatabaseRefID', 'ocrResults', 'serverInfo', 'callData']) //remove unrequired fields
        log.debug('idscan results:', { isMatch, scanResult })
        const toSign = { success: true, isMatch, gdAddress, scanResult, timestamp: Date.now() }
        const { sig: signature } = await AdminWallet.signMessage(JSON.stringify(toSign))
        res.json({ scanResult: { ...toSign, signature }, scanResultBlob })
      } catch (exception) {
        const { message } = exception
        const logArgs = ['idscan error:', message, exception, { enrollmentIdentifier, gdAddress }]

        if (shouldLogVerificaitonError(exception)) {
          log.error(...logArgs)
        } else {
          log.warn(...logArgs)
        }

        res.status(400).json({ success: false, error: message })
      }
    })
  )

  /**
   * demo for verifying that idscan was created by us
   * trigger defender autotask
   */
  app.post(
    '/verify/idscan',
    wrapAsync(async (req, res) => {
      const { log, body } = req
      const { scanResult } = body || {} // payload is the facetec data

      log.debug('idscan submit:', { payloadFields: Object.keys(scanResult) })

      try {
        const { signature, ...signed } = scanResult
        const { gdAddress } = signed
        const mHash = keccak256(JSON.stringify(signed))
        log.debug('idscan submit verifying...:', { mHash, signature })
        const publicKey = recoverPublickey(signature, mHash, '')
        const data = web3Abi.encodeFunctionCall(
          {
            name: 'addMember',
            type: 'function',
            inputs: [
              {
                type: 'address',
                name: 'member'
              }
            ]
          },
          [gdAddress]
        )
        const relayer = await AdminWallet.signer.relayer.getRelayer()

        log.debug('idscan submit verified...:', { publicKey, relayer })
        if (publicKey !== relayer.address.toLowerCase()) {
          throw new Error('invalid signer: ' + publicKey)
        }

        const addTx = await AdminWallet.signer.sendTx({
          to: '0x163a99a51fE32eEaC7407687522B5355354a1a37',
          data,
          gasLimit: '300000'
        })

        log.debug('idscan adding member:', addTx)

        res.json({ ok: 1, txHash: addTx.hash })
      } catch (exception) {
        const { message } = exception

        log.error('idscan submit failed:', message, exception)

        res.status(400).json({ ok: 0, error: message })
      }
    })
  )
  /**
   * @api {post} /verify/sendotp Sends OTP
   * @apiName Send OTP
   * @apiGroup Verification
   *
   * @apiParam {UserRecord} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/sendotp',
    passport.authenticate('jwt', { session: false }),
    userRateLimiter(2, 1), // 1 req / 1min, should be applied AFTER auth to have req.user been set
    // also no need for reqRateLimiter as user limiter falls back to the ip (e.g. works as default limiter if no user)
    wrapAsync(async (req, res) => {
      const { user, body } = req
      const log = req.log

      log.info('otp request:', { user, body })

      const onlyCheckAlreadyVerified = body.onlyCheckAlreadyVerified

      const mobile = decodeURIComponent(body.user.mobile || user.otp.mobile) //fix in case input is %2B instead of +
      const hashedMobile = sha3(mobile)
      let userRec: UserRecord = defaults(body.user, user, { identifier: user.loggedInAs })

      const savedMobile = user.mobile

      if (conf.allowDuplicateUserData === false && (await storage.isDupUserData({ mobile: hashedMobile }))) {
        return res.json({ ok: 0, error: 'mobile_already_exists' })
      }

      if (!userRec.smsValidated || hashedMobile !== savedMobile) {
        if (!onlyCheckAlreadyVerified) {
          log.debug('sending otp:', user.loggedInAs)
          if (['production', 'staging'].includes(conf.env)) {
            const clientIp = requestIp.getClientIp(req)
            const sendResult = await OTP.sendOTP(mobile, get(body, 'user.otpChannel', 'sms'), clientIp)

            log.info('otp sent:', mobile, { user: user.loggedInAs, sendResult })
          }

          await storage.updateUser({
            identifier: user.loggedInAs,
            otp: {
              ...(userRec.otp || {}),
              mobile
            }
          })
        }
      }

      res.json({ ok: 1, alreadyVerified: hashedMobile === savedMobile && user.smsValidated })
    })
  )

  /**
   * @api {post} /verify/mobile Verify mobile data code
   * @apiName OTP Code
   * @apiGroup Verification
   *
   * @apiParam {Object} verificationData
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Claim} attestation
   * @ignore
   */
  app.post(
    '/verify/mobile',
    requestRateLimiter(10, 1),
    passport.authenticate('jwt', { session: false }),
    onlyInEnv('production', 'staging'),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { user, body } = req
      const verificationData: { otp: string } = body.verificationData
      const { mobile } = user.otp || {}

      if (!mobile) {
        log.warn('mobile to verify not found or missing', 'mobile missing', new Error('mobile missing'), {
          user,
          verificationData
        })

        return res.status(400).json({ ok: 0, error: 'MOBILE MISSING' })
      }

      const hashedNewMobile = mobile && sha3(mobile)
      const currentMobile = user.mobile

      log.debug('mobile verified', { user, verificationData, hashedNewMobile })

      if (!user.smsValidated || currentMobile !== hashedNewMobile) {
        try {
          const clientIp = requestIp.getClientIp(req)
          await verifier.verifyMobile({ identifier: user.loggedInAs, mobile }, verificationData, clientIp)
        } catch (e) {
          log.warn('mobile verification failed:', e.message, { user, mobile, verificationData })
          return res.status(400).json({ ok: 0, error: 'OTP FAILED', message: e.message })
        }

        let updIndexPromise
        const { crmId } = user

        if (currentMobile && currentMobile !== hashedNewMobile) {
          updIndexPromise = Promise.all([
            //TODO: generate ceramic claim
          ])
        }

        if (crmId) {
          //fire and forget
          OnGage.updateContact(null, crmId, { mobile }, log).catch(e =>
            log.error('Error updating CRM contact', e.message, e, { crmId, mobile })
          )
        }

        await Promise.all([
          updIndexPromise,
          storage.updateUser({
            identifier: user.loggedInAs,
            smsValidated: true,
            mobile: hashedNewMobile
          }),
          user.createdDate && //keep temporary field if user is signing up
            storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.mobile': true } })
        ])
      }

      //TODO: replace with ceramic
      let signedMobile
      res.json({ ok: 1, attestation: signedMobile })
    })
  )

  /**
   * @api {post} /verify/registration Verify user registration status
   * @apiName Verify Registration Status
   * @apiGroup Verification
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/registration',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      const user = req.user
      res.json({ ok: user && user.createdDate ? 1 : 0 })
    })
  )
  /**
   * @api {post} /verify/topwallet Tops Users Wallet if needed
   * @apiName Top Wallet
   * @apiGroup Verification
   *
   * @apiParam {LoggedUser} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/topwallet',
    requestRateLimiter(3, 1),
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { origin, host } = req.headers
      const { account, chainId = 42220 } = req.body || {}
      const user: LoggedUser = req.user || { gdAddress: account }
      const clientIp = requestIp.getClientIp(req)

      const gdContract = AdminWallet.walletsMap[chainId]?.tokenContract?._address
      const faucetContract = AdminWallet.walletsMap[chainId]?.faucetContract?._address
      log.debug('topwallet tx request:', {
        address: user.gdAddress,
        chainId,
        gdContract,
        faucetContract,
        user: req.user,
        origin,
        host,
        clientIp
      })

      if (!faucetContract) {
        log.warn('topWallet unsupported chain', { chainId })
        return res.json({ ok: -1, error: 'unsupported chain' })
      }

      if (conf.env === 'production') {
        if (
          !user.isEmailConfirmed &&
          !user.smsValidated &&
          !(await AdminWallet.isVerified(user.gdAddress)) &&
          !(gdContract && (await findGDTx(user.gdAddress, chainId, gdContract)))
        ) {
          log.warn('topwallet denied, not registered user nor whitelisted nor did gd tx lately', {
            address: user.gdAddress,
            origin,
            chainId,
            clientIp
          })
          return res.json({ ok: -1, error: 'not whitelisted' })
        }
      }
      if (!user.gdAddress) {
        throw new Error('missing wallet address to top')
      }

      // check for faucet abuse
      const foundAbuse = await cachedFindFaucetAbuse(user.gdAddress, chainId).catch(e => {
        log.error('findFaucetAbuse failed', e.message, e, { address: user.gdAddress, chainId })
        return
      })

      if (foundAbuse) {
        log.warn('faucet abuse found:', foundAbuse)
        return res.json({ ok: -1, error: 'faucet abuse: ' + foundAbuse.hash })
      }

      const foundMultiIpAccounts = await checkMultiIpAccounts(user.gdAddress, clientIp, log)
      if (foundMultiIpAccounts) {
        log.warn('faucet multiip abuse found:', foundMultiIpAccounts.length, new Error('faucet multiip abuse'), {
          foundMultiIpAccounts,
          clientIp,
          account: user.gdAddress
        })
        return res.json({ ok: -1, error: 'faucet multi abuse' })
      }

      try {
        let txPromise = AdminWallet.topWallet(user.gdAddress, chainId, log)
          .then(tx => {
            log.debug('topwallet tx', { walletaddress: user.gdAddress, tx })
            return { ok: 1 }
          })
          .catch(async exception => {
            const { message } = exception
            log.warn('Failed topwallet tx', message, exception, { walletaddress: user.gdAddress }) //errors are already logged in adminwallet so jsut warn

            return { ok: -1, error: message }
          })

        const txRes = await txPromise

        log.info('topwallet tx done', {
          txRes,
          loggedInAs: user.loggedInAs
        })

        res.json(txRes)
      } catch (e) {
        log.error('topwallet timeout or unexpected', e.message, e, { walletaddress: user.gdAddress })
        res.json({ ok: -1, error: e.message })
      }
    })
  )

  /**
   * @api {post} /verify/swaphelper trigger a non custodial swap
   * @apiName Swaphelper
   * @apiGroup Verification
   *
   * @apiParam {account} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/swaphelper',
    requestRateLimiter(3, 1),
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { account, chainId = 42220 } = req.body || {}
      const gdAddress = account || get(req.user, 'gdAddress')

      log.info('swaphelper request:', { gdAddress, chainId })
      if (!gdAddress) {
        throw new Error('missing user account')
      }

      try {
        //verify target helper address has funds

        const tx = await AdminWallet.walletsMap[chainId].swaphelper(gdAddress, log)
        log.info('swaphelper request done:', { gdAddress, chainId, tx })

        res.json({ ok: 1, hash: tx.transactionHash })
      } catch (e) {
        log.error('swaphelper timeout or unexpected', e.message, e, { walletaddress: gdAddress, chainId })
        res.json({ ok: -1, error: e.message })
      }
    })
  )

  /**
   * @api {post} /verify/email Send verification email endpoint
   * @apiName Send Email
   * @apiGroup Verification
   *
   * @apiParam {UserRecord} user
   *
   * @apiSuccess {Number} ok
   * @ignore
   */
  app.post(
    '/verify/sendemail',
    requestRateLimiter(2, 1),
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)
      const log = req.log
      const { user, body } = req

      let { email } = body.user
      email = email.toLowerCase()

      if (!email || !user) {
        log.warn('email verification email or user record not found:', { email, user })
        return res.json({ ok: 0, error: 'email or user missing' })
      }

      //merge user details
      const { email: currentEmail } = user
      let userRec: UserRecord = defaults(body.user, user)
      const isEmailChanged = currentEmail && currentEmail !== sha3(email)

      let code
      log.debug('email verification request:', { email, currentEmail, isEmailChanged, body, user })

      if (runInEnv === true && conf.skipEmailVerification === false) {
        code = OTP.generateOTP(6)

        if (!user.isEmailConfirmed || isEmailChanged) {
          try {
            const { fullName } = userRec

            if (!code || !fullName || !email) {
              log.error('missing input for sending verification email', { code, fullName, email })
              throw new Error('missing input for sending verification email')
            }

            const templateData = {
              firstname: fullName,
              code: parseInt(code)
            }

            const sesResponse = await sendTemplateEmail(email, templateData)

            log.debug('sent new user email validation code', {
              email,
              code,
              sesResponse: get(sesResponse, '$response.httpResponse.statusCode'),
              sesId: get(sesResponse, 'MessageId'),
              sesError: get(sesResponse, '$response.error.message')
            })
          } catch (e) {
            log.error('failed sending email verification to user:', e.message, e, { userRec, code })
            throw e
          }
        }
      }

      // updates/adds user with the emailVerificationCode to be used for verification later
      await storage.updateUser({
        identifier: user.identifier,
        emailVerificationCode: code,
        otp: {
          ...(userRec.otp || {}),
          email
        }
      })

      res.json({ ok: 1, alreadyVerified: isEmailChanged === false && user.isEmailConfirmed })
    })
  )

  /**
   * @api {post} /verify/email Verify email code
   * @apiName Email
   * @apiGroup Verification
   *
   * @apiParam {Object} verificationData
   * @apiParam {String} verificationData.code
   *
   * @apiSuccess {Number} ok
   * @apiSuccess {Claim} attestation
   * @ignore
   */
  app.post(
    '/verify/email',
    passport.authenticate('jwt', { session: false }),
    wrapAsync(async (req, res) => {
      let runInEnv = ['production', 'staging', 'test'].includes(conf.env)
      const { __utmzz: utmString = '' } = req.cookies
      const log = req.log
      const { user, body } = req
      const verificationData: { code: string } = body.verificationData

      let { email } = user.otp || {}
      email = email && email.toLowerCase()

      const hashedNewEmail = email ? sha3(email) : null
      const currentEmail = user.email

      log.debug('email verification request', {
        user,
        body,
        email,
        verificationData,
        currentEmail,
        hashedNewEmail
      })

      if (!email) {
        log.error('email address to verify is missing')
        throw new Error('email address to verify is missing')
      }

      if (!user.isEmailConfirmed || currentEmail !== hashedNewEmail) {
        let signedEmail

        if (runInEnv && conf.skipEmailVerification === false) {
          try {
            await verifier.verifyEmail({ identifier: user.loggedInAs }, verificationData)
          } catch (e) {
            log.warn('email verification failed:', e.message, { user, email, verificationData })
            return res.status(400).json({ ok: 0, error: e.message })
          }
        }

        storage.updateUser({
          identifier: user.loggedInAs,
          isEmailConfirmed: true,
          email: hashedNewEmail
        })

        if (runInEnv) {
          storage.model.updateOne({ identifier: user.loggedInAs }, { $unset: { 'otp.email': 1 } })

          // fire and forget
          syncUserEmail(user, email, utmString, log).catch(e =>
            log.error('Error updating CRM contact', e.message, e, {
              crmId: user.crmId,
              currentEmail,
              email
            })
          )
        }

        //TODO: sign using ceramic did
        return res.json({ ok: 1, attestation: signedEmail })
      }

      return res.json({ ok: 0, error: 'nothing to do' })
    })
  )

  /**
   * @api {get} /verify/phase get release/phase version number
   * @apiName Get Phase VErsion Number
   * @apiGroup Verification
   *
   * @apiSuccess {Number} phase
   * @apiSuccess {Boolean} success
   * @ignore
   */
  app.get('/verify/phase', (_, res) => {
    const { phase } = conf

    res.json({ success: true, phase })
  })

  /**
   * @depracated now using goodcfverify cloudflare worker
   * @api {post} /verify/recaptcha verify recaptcha token
   * @apiName Recaptcha
   * @apiGroup Verification
   *
   * @apiParam {string} token
   *
   * @apiSuccess {Number} ok
   * @ignore
   */

  const visitorsCounter = {}
  app.post(
    '/verify/recaptcha',
    requestRateLimiter(10, 1),
    wrapAsync(async (req, res) => {
      const log = req.log
      const { payload: token = '', ipv6 = '', captchaType = '', fingerprint = {} } = req.body
      const clientIp = requestIp.getClientIp(req)
      const xForwardedFor = (req.headers || {})['x-forwarded-for']
      const { visitorId } = fingerprint
      let kvStorageIpKey = clientIp
      let parsedRes = {}

      try {
        if (ipv6 && ipv6 !== clientIp) {
          kvStorageIpKey = ipv6
        }
        let visitsCounter = 0
        if (visitorId) {
          visitsCounter = visitorsCounter[visitorId] || 0
          visitsCounter++
          visitorsCounter[visitorId] = visitsCounter
        }

        log.debug('Verifying recaptcha', {
          token: token.slice(0, 10),
          ipv6,
          clientIp,
          kvStorageIpKey,
          xForwardedFor,
          captchaType,
          visitorId,
          visitsCounter
        })

        //hcaptcha verify
        if (captchaType === 'hcaptcha') {
          if (!visitorId) {
            //we use fingerprint only for web with hcaptcha at the moment
            throw new Error('missing visitorId')
          }

          const recaptchaRes = await fetch('https://hcaptcha.com/siteverify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              secret: conf.hcaptchaSecretKey,
              response: token
            })
          })
          parsedRes = await recaptchaRes.json()
        } else {
          const url = `https://www.google.com/recaptcha/api/siteverify?secret=${conf.recaptchaSecretKey}&response=${token}&remoteip=${clientIp}`

          const recaptchaRes = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: '*/*'
            }
          })

          parsedRes = await recaptchaRes.json()
        }

        if (parsedRes.success) {
          const verifyResult = await OTP.verifyCaptcha(kvStorageIpKey, captchaType)

          log.debug('Recaptcha verified', { verifyResult, parsedRes })

          res.json({ success: true })
        } else {
          throw new Error('user failed captcha')
        }
      } catch (exception) {
        const { message } = exception
        const logFunc = ['user failed captcha', 'missing visitorId'].includes(message) ? 'warn' : 'error'
        log[logFunc]('Recaptcha verification failed', message, exception, {
          clientIp,
          token: token.slice(0, 10),
          captchaType,
          parsedRes
        })
        res.status(400).json({ success: false, error: message })
      }
    })
  )

  app.get(
    '/verify/offerwall',
    wrapAsync(async (req, res) => {
      const { log, query } = req
      const { user_id, value, token, signature } = query
      log.debug('offerwall payout request:', { user_id, value, token, signature })

      try {
        const { user_id, value, token, signature } = req.body

        // Secret key (replace with your actual secret key)
        const secretKey = conf.offerwallSecret

        // Concatenate the inputs with "."
        const concatenatedString = `${secretKey}.${user_id}.${value}.${token}`

        // Generate MD5 hash
        const calculatedSignature = crypto.createHash('md5').update(concatenatedString).digest('hex')

        // Compare the calculated signature with the provided signature
        if (calculatedSignature !== signature) {
          throw new Error('Invalid signature')
        }
        log.info('offerwall payout success:', { user_id, value, token })
        res.json({ success: true })
      } catch (exception) {
        const { message } = exception

        log.error('face record disposing check failed:', message, exception, { user_id, value, token, signature })
        res.status(400).json({ success: false, error: message })
      }
    })
  )
}

export default setup

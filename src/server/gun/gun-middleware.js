// @flow
import express, { Router } from 'express'

import { get, assign, identity, memoize, once } from 'lodash'
import { sha3 } from 'web3-utils'
import util from 'util'

import Gun from '@gooddollar/gun'
import SEA from '@gooddollar/gun/sea'
import { gunAuth } from '@gooddollar/gun-pk-auth'
import '@gooddollar/gun/nts'

import { delay } from '../utils/timeout'
import { wrapAsync } from '../utils/helpers'
import { LoggedUser, type StorageAPI } from '../../imports/types'
import conf from '../server.config'
import logger from '../../imports/logger'

const log = logger.child({ from: 'GunDB-Middleware' })

// TODO: import refactorings from server
assign(Gun.chain, {
  async putAck(data, callback = identity) {
    const nodeCompatiblePut = cb => this.put(data, once(ack => cb(ack.err, ack)))
    const promisifiedPut = util.promisify(nodeCompatiblePut)

    return promisifiedPut().then(callback)
  },

  async then(cb, opt) {
    var gun = this,
      p = new Promise(function(res, rej) {
        gun.once(res, { wait: 200, ...opt })
      })
    return cb ? p.then(cb) : p
  },
  async onThen(cb = identity, opts = {}) {
    opts = Object.assign({ wait: 5000, default: undefined }, opts)
    let gun = this
    const onPromise = new Promise((res, rej) => {
      gun.on((v, k, g, ev) => {
        ev.off()

        //timeout if value is undefined
        if (v !== undefined) {
          res(v)
        }
      })
    })
    let oncePromise = new Promise(function(res, rej) {
      gun.once(
        v => {
          //timeout if value is undefined
          if (v !== undefined) {
            res(v)
          }
        },
        { wait: opts.wait }
      )
    })
    const res = Promise.race([onPromise, oncePromise, delay(opts.wait + 1000).then(_ => opts.default)]).catch(
      _ => undefined
    )
    return res.then(cb)
  }
})

/**
 * @type
 */
export type Entity = {
  '@did': string,
  publicKey: string
}

/**
 * @type
 */
export type Claim = {
  issuer: Entity,
  subject: Entity,
  sig?: string,
  claim: any,
  issuedAt: Date,
  expiresAt?: Date
}

/**
 * @type
 */
export type S3Conf = {
  key: string,
  secret: string,
  bucket: string
}

/**
 * Make app use Gun.serve and put Gun as global so we can do  `node --inspect` - debug only
 */
const setup = (app: Router) => {
  global.Gun = Gun // / make global to `node --inspect` - debug only

  if (conf.gundbServerMode) {
    app.use(Gun.serve)

    log.info('Done setup Gun.serve middleware.')
  }

  // returns details about our gundb trusted indexes
  app.get(
    '/trust',
    wrapAsync(async (_, res) => {
      const indexes = GunDBPublic.trust

      res.json({
        ok: 1,
        ...indexes
      })
    })
  )

  log.info('Done setup GunDB middleware.')
}

/**
 * Gun wrapper that implements `StorageAPI`
 * Can be instantiated with a private or a public gundb and should be used to access gun accross the API server
 */
class GunDB implements StorageAPI {
  constructor(serverMode: boolean, peers: Array<string> | void = undefined) {
    log.info({ serverMode, peers })
    this.serverMode = serverMode
    this.peers = peers
    if (serverMode === false && peers === undefined) {
      if (conf.env === 'production') throw new Error('Atleast one peer required for client mode')
      else log.warn('Atleast one peer required for client mode')
    }
  }

  serverMode: boolean

  peers: Array<string>

  gun: Gun

  user: Gun

  usersCol: Gun

  serverName: string

  ready: Promise<boolean>

  session = memoize(sid => this.gun.get(sid))

  //managed user indexes
  trust: {}

  /**
   *
   * @param {typeof express} server The instance to connect gundb with
   * @param {string} password SEA password for GoodDollar user
   * @param {string} name folder to store gundb
   * @param {S3Conf} [s3] optional S3 settings instead of local file storage
   */
  async init(
    server: typeof express | Array<string> | null,
    password: string,
    name: string,
    s3?: S3Conf
  ): Promise<boolean> {
    //gun lib/les.js settings
    const gc_delay = conf.gunGCInterval || 1 * 60 * 1000 /*1min*/
    const memory = conf.gunGCMaxMemoryMB || 512
    //log connected peers information
    if (this.serverMode) {
      Gun.on('opt', ctx => {
        setInterval(() => log.info({ GunServer: ctx.opt.name, Peers: Object.keys(ctx.opt.peers).length }), gc_delay)
      })
    }
    if (this.serverMode === false) {
      log.info('Starting gun as client:', { peers: this.peers })
      this.gun = Gun({ peers: this.peers, memory: 25, file: 'radata-worker' + get(global, 'workerId', '0') })
    } else if (s3 && s3.secret) {
      log.info('Starting gun with S3:', { gc_delay, memory })
      this.gun = Gun({
        web: server,
        file: name,
        s3,
        gc_delay,
        memory,
        name,
        chunk: 1024 * 32,
        batch: 10,
        axe: true,
        multicast: false
      })
    } else {
      this.gun = Gun({ web: server, file: name, gc_delay, memory, name })
      log.info('Starting gun with radisk:', { gc_delay, memory })
      if (conf.env === 'production') log.error('Started production without S3')
    }
    this.serverName = name
    this.user = this.gun.user()
    this.ready = gunAuth(this.gun, password).then(async _ => {
      await this.initIndexes()
      this.userRoot = await this.gun.user().then(null, { wait: 2000 })
      log.debug('gun logged in', { user: this.userRoot })
      this.trust = this.getIndexes()
      log.debug('done indexes', { indexes: this.trust })
      return true
    })
    await this.ready
    log.info('gun initialized', { useris: this.user.is })
    return this.ready
  }

  /**
   * Sign Claim
   *
   * @param {string}subjectPubKey
   * @param claimData
   *
   * @returns {Promise<Claim>}
   */
  async signClaim(subjectPubKey: string, claimData: any): Claim {
    let attestation: Claim = {
      issuer: { '@did': 'did:gooddollar:' + this.user.is.pub, publicKey: this.user.is.pub },
      subject: {
        '@did': 'did:gooddollar:' + subjectPubKey,
        publicKey: subjectPubKey
      },
      claim: claimData,
      issuedAt: new Date()
    }
    let sig = await SEA.sign(attestation, this.user.pair())
    attestation.sig = sig
    return attestation
  }

  async initIndexes() {
    log.debug('initIndexes started')
    const res = await Promise.all([
      this.user.get(`users/byemail`).putAck({ init: true }),
      this.user.get(`users/bymobile`).putAck({ init: true }),
      this.user.get(`users/bywalletAddress`).putAck({ init: true })
    ]).catch(e => {
      log.error('initIndexes failed', e.message, e)
    })
    log.debug('initIndexes done', res)
  }
  getIndexes() {
    const goodDollarPublicKey = get(this, 'user.is.pub')
    const indexes = { goodDollarPublicKey }
    const keys = ['mobile', 'email', 'walletAddress']

    keys.forEach(field => {
      indexes['by' + field] = this.getIndexId(field)
    })

    return indexes
  }

  async addUserToIndex(index: string, value: String, user: LoggedUser) {
    const updateP = this.user
      .get(`users/by${index}`)
      .get(sha3(value))
      .putAck({ '#': '~' + user.profilePublickey })
      .catch(e => {
        log.error('failed updating user index', e.message, e, { index, value, user })
        return false
      })
    return updateP
  }

  async removeUserFromIndex(index: string, hashedValue: String) {
    const updateP = this.user
      .get(`users/by${index}`)
      .get(hashedValue)
      .putAck('')
      .catch(e => {
        log.error('failed removing user from index', e.message, e, { index, hashedValue })
        return false
      })
    return updateP
  }

  async getIndex(index: string) {
    const res = await this.user.get(`users/by${index}`).onThen(null, { wait: 60000 })
    return res
  }

  getIndexId(index: string) {
    const goodDollarPublicKey = get(this, 'user.is.pub')
    return `~${goodDollarPublicKey}/users/by${index}`
  }

  async getPublicProfile() {
    return this.user.is
  }
}

const GunDBPublic = new GunDB(conf.gundbServerMode, conf.gundbPeers)

export { setup, GunDBPublic, GunDB }

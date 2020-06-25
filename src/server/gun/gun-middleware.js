// @flow
import express, { Router } from 'express'
import Gun from 'gun'
import SEA from 'gun/sea'
import 'gun/lib/load'
import { assign, identity, memoize, once } from 'lodash'
import util from 'util'
import delay from 'delay'
// import les from 'gun/lib/les'
import { wrapAsync } from '../utils/helpers'
import { LoggedUser, type StorageAPI } from '../../imports/types'
import conf from '../server.config'
import logger from '../../imports/logger'
import { sha3 } from 'web3-utils'
const log = logger.child({ from: 'GunDB-Middleware' })

assign(Gun.chain, {
  async putAck(data, callback = identity) {
    const nodeCompatiblePut = cb => this.put(data, once(ack => cb(ack.err, ack)))
    const promisifiedPut = util.promisify(nodeCompatiblePut)

    return promisifiedPut().then(callback)
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
  if (conf.gundbServerMode) app.use(Gun.serve)
  global.Gun = Gun // / make global to `node --inspect` - debug only
  //returns details about our gundb trusted indexes
  app.get(
    '/trust',
    wrapAsync(async (req, res) => {
      const goodDollarPublicKey = GunDBPublic.user.is.pub
      const bymobile = await GunDBPublic.getIndexId('mobile')
      const byemail = await GunDBPublic.getIndexId('email')
      const bywalletAddress = await GunDBPublic.getIndexId('walletAddress')
      res.json({
        ok: 1,
        goodDollarPublicKey,
        bymobile,
        byemail,
        bywalletAddress
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
      this.gun = Gun({ file: name, peers: this.peers })
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
    this.user = this.gun.user()
    this.serverName = name
    const gooddollarUser = await this.gun.get('~@gooddollarorg').onThen()
    log.info('Existing gooddollarorg user:', { gooddollarUser })
    this.ready = new Promise((resolve, reject) => {
      this.user.create('gooddollarorg', password, createres => {
        log.info('Created gundb GoodDollar User', { name })
        this.user.auth('gooddollarorg', password, async authres => {
          if (authres.err) {
            log.error('Failed authenticating gundb user:', { name, error: authres.err })
            if (conf.env !== 'test') return reject(authres.err)
            resolve(false)
          }
          log.info('Authenticated GunDB user:', { name })
          this.usersCol = this.user.get('users')
          resolve(true)
        })
      })
    }).then(_ => {
      this.initIndexes()
      return _
    })
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
    const indexesInitialized = await Promise.all([
      this.user
        .get(`users/byemail`)
        .onThen(_ => _ === undefined && this.user.get(`users/byemail`).putAck({ init: true })),
      this.user
        .get(`users/bymobile`)
        .onThen(_ => _ === undefined && this.user.get(`users/bymobile`).putAck({ init: true })),
      this.user
        .get(`users/bywalletAddress`)
        .onThen(_ => _ === undefined && this.user.get(`users/bywalletAddress`).putAck({ init: true }))
    ]).catch(e => {
      log.error('initIndexes failed', { e, msg: e.message })
    })
    const goodDollarPublicKey = GunDBPublic.user.is.pub
    const bymobile = await GunDBPublic.getIndexId('mobile')
    const byemail = await GunDBPublic.getIndexId('email')
    const bywalletAddress = await GunDBPublic.getIndexId('walletAddress')
    log.debug('initIndexes', { indexesInitialized, goodDollarPublicKey, bymobile, byemail, bywalletAddress })
  }

  async addUserToIndex(index: string, value: String, user: LoggedUser) {
    const updateP = this.user
      .get(`users/by${index}`)
      .get(sha3(value))
      .putAck(user.profilePublickey)
      .catch(e => {
        log.error('failed updating user index', { index, value, user })
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
        log.error('failed removing user from index', { index, hashedValue })
        return false
      })
    return updateP
  }

  async getIndex(index: string) {
    const res = await this.user.get(`users/by${index}`).then()
    return res
  }

  async getIndexId(index: string) {
    return this.user.get(`users/by${index}`).then(_ => Gun.node.soul(_))
  }

  async getPublicProfile() {
    return this.user.is
  }
}

const GunDBPublic = new GunDB(conf.gundbServerMode, conf.gundbPeers)

export { setup, GunDBPublic, GunDB }

// @flow
import express, { Router } from 'express'
import Gun from 'gun'
import SEA from 'gun/sea'
import 'gun/lib/load'

// import les from 'gun/lib/les'
import { type StorageAPI, type UserRecord } from '../../imports/types'
import conf from '../server.config'
import logger from '../../imports/pino-logger'

const log = logger.child({ from: 'GunDB-Middleware' })

/**
 * @type
 */
type ACK = {
  ok: string,
  err: string
}

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

  /**
   *
   * @param {typeof express} server The instance to connect gundb with
   * @param {string} password SEA password for GoodDollar user
   * @param {string} name folder to store gundb
   * @param {S3Conf} [s3] optional S3 settings instead of local file storage
   */
  init(server: typeof express | Array<string> | null, password: string, name: string, s3?: S3Conf): Promise<boolean> {
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
      this.gun = Gun({ file: name, peers: this.peers, axe: true, multicast: false })
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
      this.gun = Gun({ web: server, file: name, gc_delay, memory, name, axe: true, multicast: false })
      log.info('Starting gun with radisk:', { gc_delay, memory })
      if (conf.env === 'production') log.error('Started production without S3')
    }
    this.user = this.gun.user()
    this.serverName = name
    this.ready = new Promise((resolve, reject) => {
      this.user.create('gooddollar', password, createres => {
        log.info('Created gundb GoodDollar User', { name })
        this.user.auth('gooddollar', password, async authres => {
          if (authres.error) {
            log.error('Failed authenticating gundb user:', name, authres.error)
            return reject(authres.error)
          }
          log.info('Authenticated GunDB user:', { name })
          this.usersCol = this.user.get('users')
          resolve(true)
        })
      })
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
}

const GunDBPublic = new GunDB(conf.gundbServerMode, conf.gundbPeers)

export { setup, GunDBPublic, GunDB }

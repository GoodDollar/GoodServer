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

Gun.chain.putAck = function(data, cb) {
  var gun = this,
    cb =
      cb ||
      function(ctx) {
        return ctx
      }
  let promise = new Promise((res, rej) => gun.put(data, ack => (ack.err ? rej(ack) : res(ack))))
  return promise.then(cb)
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
   * remove the soul field(_) from gun records
   * @param {*} gun record
   */
  recordSanitize(obj: any = {}) {
    if (obj._ !== undefined) {
      const { _, ...record } = obj
      return record
    }

    return obj
  }

  getUser(identifier: string): Promise<UserRecord | void> {
    return new Promise(async res => {
      const profileNode = this.usersCol.get(identifier)
      profileNode.load(p => res(p))
      let isNode = await profileNode
      if (isNode === undefined) {
        res(undefined)
      }
    })
  }

  async getUserByEmail(email: string): Promise<UserRecord> {
    let identifier = await this.usersCol.get('byemail').get(email)
    return identifier && this.getUser(identifier)
  }
  async getUserByMobile(mobile: string): Promise<UserRecord> {
    let identifier = await this.usersCol.get('bymobile').get(mobile)
    return identifier && this.getUser(identifier)
  }
  getUserField(identifier: string, field: string): Promise<any> {
    return this.usersCol
      .get(identifier)
      .get(field)
      .then(this.recordSanitize)
  }

  async addUser(user: UserRecord): Promise<boolean> {
    return this.updateUser(user)
  }

  async updateUser(user: UserRecord): Promise<boolean> {
    const { identifier } = user
    const isDup = await this.isDupUserData(user)

    let promises = []
    //for non production we can allowDuplicateUserData
    if (!isDup || conf.allowDuplicateUserData) {
      log.info('Updating user', { identifier, user })
      try {
        promises.push(
          this.usersCol.get(identifier).put(user)
          //.then()
        )

        if (user.email) {
          const { email } = user
          promises.push(
            this.usersCol
              .get('byemail')
              .get(email)
              .put(identifier)
            //.then()
          )
        }

        if (user.mobile) {
          const { mobile } = user
          promises.push(
            this.usersCol
              .get('bymobile')
              .get(mobile)
              .put(identifier)
            //.then()
          )
        }
      } catch (ex) {
        logger.error('Update user failed [gun actions]:', { message: ex.message, user })
      }

      return Promise.all(promises)
        .catch(e => logger.error('Update user failed:', { e, user }))
        .then(r => true)
      // return true
    }

    return Promise.reject(new Error('Duplicate user information (phone/email)'))
    // this.user.get('users').get(identifier).secret({...user, jwt})
  }

  async isDupUserData(user: UserRecord) {
    if (user.email) {
      const res = await this.usersCol
        .get('byemail')
        .get(user.email)
        .then()
      const profile = res && (await this.usersCol.get(res))
      if (res && res !== user.identifier && profile) return true
    }

    if (user.mobile) {
      const res = await this.usersCol
        .get('bymobile')
        .get(user.mobile)
        .then()
      const profile = res && (await this.usersCol.get(res))
      if (res && res !== user.identifier && profile) return true
    }

    return false
  }

  async deleteUser(user: UserRecord): Promise<boolean> {
    const { identifier } = user
    const userRecord = await this.usersCol.get(identifier).then()
    log.info('deleteUser fetched record:', { userRecord, identifier })
    if (userRecord.email) {
      this.usersCol
        .get('byemail')
        .get(userRecord.email)
        .put(null)
    }

    if (userRecord.mobile) {
      this.usersCol
        .get('bymobile')
        .get(userRecord.mobile)
        .put(null)
    }

    await this.usersCol.get(identifier).putAck(null)
    return true
  }

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

  listUsers(cb: ({ [string]: UserRecord }) => void) {
    this.usersCol.load(cb, { wait: 1000 })
  }
}

const GunDBPublic = new GunDB(conf.gundbServerMode, conf.gundbPeers)
const GunDBPrivate = new GunDB()

GunDBPrivate.init(null, conf.gundbPassword, 'privatedb', conf.gunPrivateS3).catch(e => {
  log.error(e)
  process.exit(-1)
})

export { setup, GunDBPublic, GunDBPrivate, GunDB }

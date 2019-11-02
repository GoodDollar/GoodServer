import networks from './networks'
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'

require('dotenv').config()
const convict = require('convict')

// Define a schema
const conf = convict({
  env: {
    doc: 'The applicaton environment.',
    format: ['production', 'development', 'staging', 'test'],
    default: 'development',
    arg: 'nodeEnv',
    env: 'NODE_ENV'
  },
  logLevel: {
    doc: 'Log level',
    format: ['debug', 'error', 'warn', 'info', 'off', 'trace', 'silent'],
    default: 'debug',
    env: 'LOG_LEVEL'
  },
  ip: {
    doc: 'The IP address to bind.',
    format: 'ipaddress',
    default: '127.0.0.1',
    env: 'IP_ADDRESS'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3003,
    env: 'PORT'
  },
  gundbPassword: {
    doc: 'The password to gundb',
    format: '*',
    default: '',
    env: 'GUNDB_PASS'
  },
  gundbPeers: {
    doc: 'superpeer to connect with for public db as a client if server mode is off',
    format: Array,
    default: undefined,
    env: 'GUNDB_PEERS'
  },
  gundbServerMode: {
    doc: 'should we start as a superpeer',
    format: Boolean,
    default: true,
    env: 'GUNDB_SERVERMODE'
  },
  jwtPassword: {
    doc: 'The password to sign the JWT token with',
    format: '*',
    default: undefined,
    env: 'JWT_PASS'
  },
  mnemonic: {
    doc: 'Wallet mnemonic',
    format: '*',
    env: 'MNEMONIC',
    default: ''
  },
  numberOfAdminWalletAccounts: {
    doc: 'Number of admin wallet accounts',
    format: Number,
    env: 'NUMBER_OF_ADMIN_WALLET_ACCOUNTS',
    default: 10
  },
adminMinBalance: {
    doc: 'min balance in GWEIs for valid admin addresses',
    format: Number,
    env: 'ADMIN_MIN_BALANCE',
    default: 100000
  },
  mongoQueueMaxLockTime: {
    doc: 'Max lock time for one each in mongo queue in seconds',
    format: Number,
    env: 'MONGO_QUEUE_MAX_LOCK_TIME',
    default: 30
  },
  privateKey: {
    doc: 'Wallet private key',
    format: '*',
    env: 'PRIVATE_KEY',
    default: undefined
  },
  infuraKey: {
    doc: 'Infura API Key',
    format: '*',
    env: 'INFURA_API',
    default: ''
  },
  ethereum: {
    network_id: 42,
    httpWeb3Provider: 'https://kovan.infura.io/v3/',
    websocketWeb3Provider: 'wss://kovan.infura.io/ws',
    web3Transport: 'HttpProvider'
  },
  network: {
    doc: 'The blockchain network to connect to',
    format: [
      'kovan',
      'mainnet',
      'rinkbey',
      'ropsten',
      'truffle',
      'ganache',
      'fuse',
      'production',
      'develop',
      'staging',
      'etoro'
    ],
    default: 'develop',
    env: 'NETWORK'
  },
  twilioAuthID: {
    doc: "Twilio's authorization ID",
    format: '*',
    env: 'TWILIO_AUTH_ID',
    default: ''
  },
  twilioAuthToken: {
    doc: "Twilio's authorization Token",
    format: '*',
    env: 'TWILIO_AUTH_TOKEN',
    default: ''
  },
  twilioPhoneNumber: {
    doc: "Plivo's Phone Number",
    format: '*',
    env: 'TWILIO_PHONE_NUMBER',
    default: ''
  },

  otpDigits: {
    doc: 'Amount of digits for the OTP',
    format: '*',
    env: 'OTP_DIGITS',
    default: '6'
  },
  otpTtlMinutes: {
    doc: 'Time, in minutes, for the OTP to be valid',
    format: '*',
    env: 'OTP_TTL_MINUTES',
    default: '60'
  },
  sendGrid: {
    apiKey: {
      doc: 'Sendgrid API KEY',
      format: '*',
      env: 'SENDGRID_API_KEY',
      default: 'YOUR_API_KEY'
    },
    templates: {
      recoveryInstructions: {
        doc: 'Sendgrid Transactional Template ID',
        format: '*',
        env: 'SENDGRID_TEMPLATE_RECOVERY_INSTRUCTIONS',
        default: ''
      },
      emailConfirmation: {
        doc: 'Sendgrid Transactional Template ID',
        format: '*',
        env: 'SENDGRID_TEMPLATE_EMAIL_CONFIRMATION',
        default: ''
      }
    }
  },
  mongodb: {
    uri: {
      doc: 'Mongo DB URI',
      format: '*',
      env: 'MONGO_DB_URI',
      default: ''
    }
  },
  noReplyEmail: {
    doc: 'no-reply GD email',
    format: '*',
    env: 'NO_REPLY_GD_EMAIL',
    default: 'no-reply@gooddollar.com'
  },
  walletUrl: {
    doc: 'wallet URL',
    format: '*',
    env: 'WALLET_URL',
    default: 'WALLET_URL'
  },
  faceRecoServer: {
    doc: 'Face Recognition Server URL',
    format: '*',
    env: 'FACE_RECO_SERVER',
    default: 'FACE_RECO_SERVER'
  },
  mauticURL: {
    doc: 'mautic URL',
    format: '*',
    env: 'MAUTIC_URL',
    default: 'WALLET_URL'
  },
  mauticToken: {
    doc: 'mautic token',
    format: '*',
    env: 'MAUTIC_TOKEN',
    default: 'MAUTIC_TOKEN'
  },
  mauticRecoveryEmailId: {
    doc: 'id of email template',
    format: '*',
    env: 'MAUTIC_RECOVERY_ID',
    default: '9'
  },
  mauticmagicLinkEmailId: {
    doc: 'id of email template',
    format: '*',
    env: 'MAUTIC_MAGICLINK_ID',
    default: '30'
  },
  mauticVerifyEmailId: {
    doc: 'id of email template',
    format: '*',
    env: 'MAUTIC_VERIFY_ID',
    default: '31'
  },
  zoomURL: {
    doc: 'Zoom Client URL',
    format: '*',
    env: 'ZOOM_API_URL',
    default: 'https://api.zoomauth.com/api/v1/biometrics'
  },
  zoomToken: {
    doc: 'Zoom APP Token',
    format: '*',
    env: 'ZOOM_TOKEN',
    default: ''
  },
  zoomMinMatchLevel: {
    doc: 'Zoom minimum match level in search',
    format: '*',
    env: 'ZOOM_MIN_MATCH_LEVEL',
    default: 1
  },
  gunPrivateS3: {
    key: {
      format: '*',
      default: undefined
    },
    secret: {
      format: '*',
      default: undefined
    },
    bucket: {
      format: '*',
      default: undefined
    }
  },
  gunPublicS3: {
    key: {
      format: '*',
      default: undefined
    },
    secret: {
      format: '*',
      default: undefined
    },
    bucket: {
      format: '*',
      default: undefined
    }
  },
  allowDuplicateUserData: {
    doc: 'Allow to register with existing mobile/email',
    format: Boolean,
    env: 'ALLOW_DUPLICATE_USER_DATA',
    default: false
  },
  skipEmailVerification: {
    doc: 'Allow to register with unverified email',
    format: Boolean,
    env: 'SKIP_EMAIL_VERIFICATION',
    default: false
  },
  skipFaceRecognition: {
    doc: 'Returns FR passed with no Zoom API interaction',
    format: Boolean,
    env: 'SKIP_FACE_RECO',
    default: false
  },
  allowFaceRecognitionDuplicates: {
    doc: 'Allows passing FR process even if duplicate exists',
    format: Boolean,
    env: 'ALLOW_FACE_RECO_DUPS',
    default: false
  },
  enableMongoLock: {
    doc: 'Enable or disable transaction locks for mongo',
    format: Boolean,
    env: 'ENABLE_MONGO_LOCK',
    default: false
  },
  disableFaceVerification: {
    doc: 'Whitelist user once they register',
    format: Boolean,
    env: 'DISABLE_FACE_VERIFICATION',
    default: true
  },
  rollbarToken: {
    doc: 'access token for rollbar logging',
    format: '*',
    env: 'ROLLBAR_TOKEN',
    default: undefined
  },
  secure_key: {
    doc: 'Secure key word used to create secure hash by which server can communicate with web3',
    format: '*',
    env: 'SECURE_KEY',
    default: undefined
  },
  fuse: {
    doc: 'Main url for fuse api',
    format: String,
    env: 'FUSE_API',
    default: null
  },
  web3SiteUrl: {
    doc: 'Web3 site url',
    format: '*',
    env: 'WEB3_SITE_URL',
    default: undefined
  },
  marketPassword: {
    doc: 'password for market jwt',
    format: String,
    env: 'MARKET_PASSWORD',
    default: null
  },
  rateLimitMinutes: {
    doc: 'Amount of minutes used for request rate limiter',
    format: '*',
    env: 'REQUEST_RATE_LIMIT_MINUTES',
    default: 1
  },
  rateLimitRequestsCount: {
    doc: 'Max number of requests count per rateLimitMinutes',
    format: '*',
    env: 'REQUEST_RATE_LIMIT_COUNT',
    default: 3
  }
})

// Load environment dependent configuration
const env = conf.get('env')
const network = conf.get('network')
const networkId = ContractsAddress[network].networkId
conf.set('ethereum', networks[networkId])
//parse S3 details for gundb in format of key,secret,bucket
const privateS3 = process.env.GUN_PRIVATE_S3
if (privateS3) {
  let s3Vals = privateS3.split(',')
  let s3Conf = { key: s3Vals[0], secret: s3Vals[1], bucket: s3Vals[2] }
  conf.set('gunPrivateS3', s3Conf)
}
const publicS3 = process.env.GUN_PUBLIC_S3
if (publicS3) {
  let s3Vals = publicS3.split(',')
  let s3Conf = { key: s3Vals[0], secret: s3Vals[1], bucket: s3Vals[2] }
  conf.set('gunPublicS3', s3Conf)
}
// Perform validation
conf.validate({ allowed: 'strict' })
// eslint-disable-next-line

export default conf.getProperties()

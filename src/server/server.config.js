import fs from 'fs'
import path from 'path'
import { get } from 'lodash'
import convict from 'convict'
import dotenv from 'dotenv'

import getNetworks from './networks'
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'

import { version } from '../../package.json'

let dotenvPath = '.env'

if (process.env.NODE_ENV === 'test') {
  dotenvPath += '.test'

  if (fs.existsSync(path.resolve(__dirname, '../../.env.test.local'))) {
    dotenvPath += '.local'
  }
}

dotenv.config({ path: dotenvPath })

// Define a schema
const conf = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'staging', 'test'],
    default: 'development',
    arg: 'nodeEnv',
    env: 'NODE_ENV'
  },
  version: {
    doc: 'The application version from package.json.',
    format: String,
    default: version,
    env: 'VERSION'
  },
  phase: {
    doc: 'The application release/phase version',
    format: Number,
    default: 0,
    env: 'RELEASE_PHASE'
  },
  logLevel: {
    doc: 'Log level',
    format: ['error', 'warn', 'info', 'debug', 'silent'],
    default: 'debug',
    env: 'LOG_LEVEL'
  },
  remoteLoggingAllowed: {
    doc: 'allow log errors to the bug tracking systems (e.g. Sentry)',
    format: Boolean,
    default: true,
    env: 'REMOTE_LOGGING_ALLOWED'
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
    format: String,
    env: 'MNEMONIC',
    default: null
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
    default: 1000000
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
  ethereumMainnet: {
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
  twilioVerifyID: {
    doc: "Twilio's verify service id",
    format: '*',
    env: 'TWILIO_VERIFY_ID',
    default: ''
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
    default: null
  },
  mauticBasicToken: {
    doc: 'mautic basic auth token',
    format: String,
    env: 'MAUTIC_BASIC_TOKEN',
    default: ''
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
  mauticClaimQueueSegmentId: {
    doc: 'id of segment',
    format: '*',
    env: 'MAUTIC_CLAIM_QUEUE_SEG_ID',
    default: '52'
  },
  mauticClaimQueueApprovedSegmentId: {
    doc: 'id of segment',
    format: '*',
    env: 'MAUTIC_CLAIM_QUEUE_APPROVED_SEG_ID',
    default: '53'
  },
  mauticClaimQueueWhitelistedSegmentId: {
    doc: 'id of segment',
    format: '*',
    env: 'MAUTIC_CLAIM_QUEUE_WHITELISTED_SEG_ID',
    default: '54'
  },
  zoomMinimalMatchLevel: {
    doc: 'Minimal FaceTec Match Level threshold to mark enrollment as duplicate',
    format: Number,
    env: 'ZOOM_MINIMAL_MATCHLEVEL',
    default: 1
  },
  zoomServerBaseUrl: {
    doc: 'FaceTec Managed Testing API URL',
    format: '*',
    env: 'ZOOM_SERVER_BASEURL',
    default: 'https://api.zoomauth.com/api/v2/biometrics'
  },
  zoomLicenseKey: {
    doc: 'Zoom (Face Recognition / Liveness Test API) License key',
    format: '*',
    env: 'ZOOM_LICENSE_KEY',
    default: ''
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
  enableMongoLock: {
    doc: 'Enable or disable transaction locks for mongo',
    format: Boolean,
    env: 'ENABLE_MONGO_LOCK',
    default: false
  },
  keepFaceVerificationRecords: {
    doc:
      'Time interval (in hours) to store face verification records after user deletes his account.' +
      ' Set to 0 or -1 to remove face verification records immediately',
    format: Number,
    env: 'KEEP_FACE_VERIFICATION_RECORDS',
    default: 24
  },
  faceVerificationCron: {
    doc: 'Cron schedule for the delayed task removing face verification records',
    format: String,
    env: 'FACE_VERIFICATION_CRON',
    default: '0 0 * * * *'
  },
  disableFaceVerification: {
    doc: 'Whitelist user once they register, returns already enrolled with no Zoom API interaction',
    format: Boolean,
    env: 'DISABLE_FACE_VERIFICATION',
    default: false
  },
  allowDuplicatedFaceRecords: {
    doc: 'Skips duplicates / liveness check during Zoom API interaction',
    format: Boolean,
    env: 'ALLOW_DUPLICATED_FACE_RECORDS',
    default: false
  },
  sentryDSN: {
    doc: 'access token for sentry logging',
    format: String,
    env: 'SENTRY_DSN',
    default: ''
  },
  secure_key: {
    doc: 'Secure key word used to create secure hash by which server can communicate with web3',
    format: String,
    env: 'SECURE_KEY',
    default: null
  },
  fuse: {
    doc: 'Main url for fuse api',
    format: 'url',
    env: 'FUSE_API',
    default: 'https://explorer.fuse.io'
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
  },
  isEtoro: {
    doc: 'eToro GoodMarket',
    format: Boolean,
    env: 'ETORO',
    default: false
  },
  topAdminsOnStartup: {
    doc: 'call topAdmins in adminwallet smart contract',
    format: '*',
    env: 'TOP_ADMINS',
    default: false
  },
  claimQueueAllowed: {
    doc: 'From how many users start to enqueue',
    format: Number,
    env: 'CLAIM_QUEUE_ALLOWED',
    default: 0
  },
  facebookGraphApiUrl: {
    doc: 'Facebook GraphAPI base url',
    format: '*',
    env: 'FACEBOOK_GRAPH_API_URL',
    default: 'https://graph.facebook.com'
  },
  fishTaskDisabled: {
    doc: 'Disables fishing cron task (default true)',
    format: Boolean,
    env: 'FISH_TASK_DISABLED',
    default: false
  },
  fishTaskCron: {
    doc: 'cron string for fishing task',
    format: String,
    env: 'FISH_TASK_CRON',
    default: '0 0 * * * *'
  },
  stakeTaskDisabled: {
    doc: 'Disables staking model cron task (default true)',
    format: Boolean,
    env: 'STAKE_TASK_DISABLED',
    default: false
  },
  stakeTaskCron: {
    doc: 'cron string for staking model task',
    format: String,
    env: 'STAKE_TASK_CRON',
    default: '0 0 * * * *'
  },
  dbUpdateTaskCron: {
    doc: 'cron string for db updates task',
    format: String,
    env: 'DBUPDATE_TASK_CRON',
    default: '0 0 0 * * *'
  },
  enrollDisposalCron: {
    doc: 'cron string for enroll disposal periodic task',
    format: String,
    env: 'DISPOSE_ENROLLMENTS_TASK_CRON',
    default: '0 0 0 * * *'
  },
  torusNetwork: {
    doc: 'Torus network. Default: ropsten (mainnet, kovan, fuse, etoro, production, develop)',
    format: ['mainnet', 'ropsten', 'kovan', 'fuse', 'etoro', 'production', 'develop'],
    default: 'ropsten',
    env: 'TORUS_NETWORK'
  },
  torusProxyContract: {
    doc: 'Torus proxy contract address',
    format: '*',
    env: 'TORUS_PROXY_CONTRACT',
    default: '0x4023d2a0D330bF11426B12C6144Cfb96B7fa6183'
  },
  torusGoogle: {
    doc: 'torus google verifier',
    format: String,
    default: 'google-gooddollar',
    env: 'TORUS_GOOGLE'
  },
  torusFacebook: {
    doc: 'torus facebook verifier',
    format: String,
    default: 'facebook-gooddollar',
    env: 'TORUS_FACEBOOK'
  },
  torusGoogleAuth0: {
    doc: 'torus google-auth0 verifier',
    format: String,
    default: 'google-auth0-gooddollar',
    env: 'TORUS_GOOGLEAUTH0'
  },
  torusAuth0SMS: {
    doc: 'torus auth0 sms verifier',
    format: String,
    default: 'gooddollar-auth0-sms-passwordless',
    env: 'TORUS_AUTH0SMS'
  },
  torusVerificationAttempts: {
    doc: 'Amount of proof verification attempts',
    format: Number,
    default: 3,
    env: 'TORUS_VERIFICATION_ATTEMPTS'
  },
  torusVerificationRetryDelay: {
    doc: 'Delay before next attempt after failure',
    format: Number,
    default: 50,
    env: 'TORUS_VERIFICATION_RETRY_DELAY'
  },
  newuserTag: {
    doc: 'mautic tag for new user. incremented by phases',
    format: String,
    default: 'dappuser',
    env: 'MAUTIC_NEWUSER_TAG'
  },
  slackAlertsWebhook: {
    doc: 'secret url for sending alerts to some channel',
    format: String,
    default: '',
    env: 'SLACK_ALERTS_WEBHOOK'
  },
  adminWalletPassword: {
    doc: 'password to admin mnemonic',
    format: String,
    default: '',
    env: 'ADMIN_PASSWORD'
  },
  maxGasPrice: {
    doc: 'ethereum mainnet max gas price in gwei',
    format: Number,
    default: 200,
    env: 'MAX_GAS_PRICE'
  },
  optionalMobile: {
    doc: 'make mobile verification optional on signup',
    format: Boolean,
    default: true,
    env: 'OPTIONAL_MOBILE_VERIFIICATION'
  },
  fullStoryKey: {
    doc: 'api key for fullstory gdpr',
    format: String,
    default: '',
    env: 'FULLSTORY_KEY'
  },
  amplitudeBasicAuth: {
    doc: 'basic auth token from api+secret for amplitude gdpr',
    format: String,
    default: '',
    env: 'AMPLITUDE_KEY'
  },
  awsSesAccessKey: {
    doc: 'aws ses access key for email verification',
    format: String,
    default: '',
    env: 'AWS_SES_ACCESS_KEY'
  },
  awsSesSecretAccessKey: {
    doc: 'aws ses secret access key for email verification',
    format: String,
    default: '',
    env: 'AWS_SES_SECRET_ACCESS_KEY'
  },
  awsSesRegion: {
    doc: 'aws ses region for email verification',
    format: String,
    default: 'eu-west-1',
    env: 'AWS_SES_REGION'
  },
  awsSesSourceVerificationEmail: {
    doc: 'aws ses source verification email',
    format: String,
    default: 'GoodDollar <support@gooddollar.org>',
    env: 'AWS_SES_SOURCE_VERIFICATION_EMAIL'
  },
  awsSesTemplateName: {
    doc: 'aws ses template name verification email',
    format: String,
    default: 'VerificationEmail',
    env: 'AWS_SES_TEMPLATE_NAME'
  }
})

// Load environment dependent configuration

// network options
const networks = getNetworks()
const network = conf.get('network')
const networkId = ContractsAddress[network].networkId
const mainNetworkId = get(ContractsAddress, `${network}-mainnet.networkId`, networkId)

conf.set('ethereumMainnet', networks[mainNetworkId])
conf.set('ethereum', networks[networkId])

// GUN S3 options
const privateS3 = process.env.GUN_PRIVATE_S3
const publicS3 = process.env.GUN_PUBLIC_S3

// parse S3 details for gundb in format of key,secret,bucket
if (privateS3) {
  const [key, secret, bucket] = privateS3.split(',')

  conf.set('gunPrivateS3', { key, secret, bucket })
}

if (publicS3) {
  const [key, secret, bucket] = publicS3.split(',')

  conf.set('gunPublicS3', { key, secret, bucket })
}

// Perform validation
conf.validate({ allowed: 'strict' })

// eslint-disable-next-line
export default conf.getProperties()

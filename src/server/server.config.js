import fs from 'fs'
import path from 'path'
import convict from 'convict'
import dotenv from 'dotenv'
import formats from 'convict-format-with-validator'

import getNetworks from './networks'

import { version, description } from '../../package.json'

export const appName = description.replace(/\s*server\s*/i, '')

let dotenvPath = '.env'

//for jest make sure we load .env.test
if (process.env.NODE_ENV === 'test') {
  dotenvPath += '.test'

  if (fs.existsSync(path.resolve(__dirname, '../../.env.test.local'))) {
    dotenvPath += '.local'
  }
}

convict.addFormats(formats)
dotenv.config({ path: dotenvPath })

// Define a schema
const conf = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'staging', 'test'],
    default: 'development',
    arg: 'nodeEnv',
    env: 'ENV'
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
    format: ['error', 'warn', 'info', 'debug', 'silent', 'trace'],
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
  adminPassword: {
    doc: 'The password to adminAuth middleware',
    format: '*',
    default: '',
    env: 'ADMIN_PASS'
  },
  jwtPassword: {
    doc: 'The password to sign the JWT token with',
    format: '*',
    default: undefined,
    env: 'JWT_PASS'
  },
  jwtExpiration: {
    doc: 'The JWT expiration time',
    format: Number,
    default: 60 * 60 * 24 * 7, // 1 week
    env: 'JWT_EXPIRATION'
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
    web3Transport: 'HttpProvider',
    explorer: ''
  },
  celo: {
    network_id: 42220,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://forno.celo.org',
    websocketWeb3Provider: '',
    explorer: ''
  },
  base: {
    network_id: 8453,
    web3Transport: 'HttpProvider',
    httpWeb3Provider: 'https://mainnet.base.org',
    websocketWeb3Provider: '',
    explorer: ''
  },
  ethereumMainnet: {
    network_id: 42,
    httpWeb3Provider: 'https://kovan.infura.io/v3/',
    websocketWeb3Provider: 'wss://kovan.infura.io/ws',
    web3Transport: 'HttpProvider',
    explorer: ''
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
      'etoro',
      'dapptest'
    ],
    default: 'develop',
    env: 'NETWORK'
  },
  httpProviderStrategy: {
    doc: 'A way to pick up other RPC endpoint on fallback',
    format: ['next', 'random'],
    default: 'next',
    env: 'HTTP_PROVIDER_STRATEGY'
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
  recaptchaSecretKey: {
    doc: 'Recaptcha secret key',
    format: '*',
    env: 'RECAPTCHA_SECRET_KEY',
    default: ''
  },
  hcaptchaSecretKey: {
    doc: 'hcaptcha secret key',
    format: '*',
    env: 'HCAPTCHA_SECRET_KEY',
    default: '0x0000000000000000000000000000000000000000'
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
  ongageUrl: {
    doc: 'ongage URL',
    format: '*',
    env: 'ONGAGE_URL',
    default: 'https://api.ongage.net/api'
  },
  ongageAccount: {
    doc: 'ongage account code',
    format: '*',
    env: 'ONGAGE_ACCOUNT_CODE',
    default: 'gooddollar_limited'
  },
  ongageKey: {
    doc: 'ongage user/key',
    format: String,
    env: 'ONGAGE_KEY',
    default: ''
  },
  ongageSecret: {
    doc: 'ongage secret/password',
    format: String,
    env: 'ONGAGE_SECRET',
    default: ''
  },
  ongageTimeout: {
    doc: 'Max time for the OnGage CRM API call',
    format: Number,
    default: 15000,
    env: 'ONGAGE_TIMEOUT'
  },
  ongageRetryAttempts: {
    doc: 'Amount of OnGage CRM API call attempts on timeout/limit exceeded',
    format: Number,
    default: 3,
    env: 'ONGAGE_RETRY_ATTEMPTS'
  },
  ongageRetryDelay: {
    doc: 'Delay before next OnGage call attempt after timeout',
    format: Number,
    default: 250,
    env: 'ONGAGE_RETRY_DELAY'
  },
  otpRetryAttempts: {
    doc: 'Amount of SMS OTPs send attempts on request rate exceeded',
    format: Number,
    default: 3,
    env: 'OTP_RETRY_ATTEMPTS'
  },
  otpRetryDelay: {
    doc: 'Delay before next OTP send attempt after timeout',
    format: Number,
    default: 250,
    env: 'OTP_RETRY_DELAY'
  },
  zoomMinimalMatchLevel: {
    doc: 'Minimal FaceTec Match Level threshold to mark enrollment as duplicate',
    format: Number,
    env: 'ZOOM_MINIMAL_MATCHLEVEL',
    default: 1
  },
  zoomSearchIndexName: {
    doc: 'FaceTec 3d DB search index name',
    format: '*',
    env: 'ZOOM_SEARCH_INDEX_NAME',
    default: appName
  },
  zoomServerBaseUrl: {
    doc: 'FaceTec Managed Testing API URL',
    format: '*',
    env: 'ZOOM_SERVER_BASEURL',
    default: 'https://api.facetec.com/api/v3.1/biometrics'
  },
  zoomLicenseKey: {
    doc: 'Zoom (Face Recognition / Liveness Test API) License key',
    format: '*',
    env: 'ZOOM_LICENSE_KEY',
    default: ''
  },
  zoomProductionMode: {
    doc: 'Enables fetching production key and initializes Zoom in production mode',
    format: Boolean,
    env: 'ZOOM_PRODUCTION_MODE',
    default: false
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
  storageCleanupEnabled: {
    doc: 'Enables cron job the abandoned signups cleanup',
    format: Boolean,
    env: 'STORAGE_CLEANUP_ENABLED',
    default: false
  },
  storageCleanupCron: {
    doc: 'Cron schedule for the abandoned signups cleanup',
    format: String,
    env: 'STORAGE_CLEANUP_CRON',
    default: '0 0 0 * * *'
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
    doc: 'Whitelist user once they register, disables face verification totally',
    format: Boolean,
    env: 'DISABLE_FACE_VERIFICATION',
    default: false
  },
  skipFaceVerification: {
    doc: 'Skips face verification process, returns already enrolled with no Zoom API interaction',
    format: Boolean,
    env: 'SKIP_FACE_VERIFICATION',
    default: false
  },
  sentryDSN: {
    doc: 'access token for sentry logging',
    format: String,
    env: 'SENTRY_DSN',
    default: ''
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
    format: Boolean,
    env: 'TOP_ADMINS',
    default: false
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
    default: true
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
  torusNetwork: {
    doc: 'Torus network. Default: ropsten (mainnet, kovan, fuse, etoro, production, develop)',
    format: [
      'mainnet',
      'ropsten',
      'kovan',
      'fuse',
      'etoro',
      'production',
      'develop',
      'testnet',
      'https://billowing-responsive-arm.ropsten.discover.quiknode.pro/e1f91ad991da6c4a3558e1d2450238ea1fe17af1/'
    ],
    default: 'https://billowing-responsive-arm.ropsten.discover.quiknode.pro/e1f91ad991da6c4a3558e1d2450238ea1fe17af1/',
    env: 'TORUS_NETWORK'
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
  torusVerificationTimeout: {
    doc: 'Max time for email/phone verificarion attempt',
    format: Number,
    default: 5000,
    env: 'TORUS_VERIFICATION_TIMEOUT'
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
  torusClientId: {
    doc: 'client id for web3auth',
    format: String,
    default: 'BLQmq83LgX8FRbjPcZ5lVX8EJUjrioOiw3YQd6qCoWs3Of8F2dZRD2nThUSLpbyKO7U3-bXe0D3j8hgjntShi40',
    env: 'TORUS_CLIENT_ID'
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
  defaultGasPrice: {
    doc: 'Default gas price in gwei',
    format: Number,
    default: 10,
    env: 'DEFAULT_GAS_PRICE'
  },
  estimateGasPrice: {
    doc: 'If turned on, gas price received form blockchain will override default value',
    format: Boolean,
    default: false,
    env: 'ESTIMATE_GAS_PRICE'
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
  },
  awsS3Region: {
    doc: 'aws region for S3 file uploads',
    format: String,
    default: 'us-east-1',
    env: 'AWS_S3_REGION'
  },
  cfWorkerVerifyJwtSecret: {
    doc: 'Cloudflare verify worker JWT secret',
    format: String,
    default: '',
    env: 'CF_WORKER_VERIFY_JWT_SECRET'
  },
  cfWorkerVerifyJwtAudience: {
    doc: 'Cloudflare verify worker JWT audience',
    format: String,
    default: '',
    env: 'CF_WORKER_VERIFY_JWT_AUDIENCE'
  },
  cfWorkerVerifyJwtSubject: {
    doc: 'Cloudflare verify worker JWT subject',
    format: String,
    default: '',
    env: 'CF_WORKER_VERIFY_JWT_SUBJECT'
  },
  cfWorkerVerifyUrl: {
    doc: 'Cloudflare verify worker URL',
    format: String,
    default: '',
    env: 'CF_WORKER_VERIFY_URL'
  },
  enableWhitelistAtChain: {
    doc: 'Enabled whitelisted on chainId specified feature',
    format: Boolean,
    env: 'ENABLE_WHITELIST_AT_CHAIN',
    default: true
  },
  defaultWhitelistChainId: {
    doc: 'Mark user as whitelisted on chainId if not supplied',
    format: Number,
    env: 'WHITELIST_CHAINID',
    default: 42220
  },
  forceFaucetCall: {
    doc: 'If user has enough gas to call faucet dont call faucet for them',
    format: Boolean,
    env: 'FORCE_FAUCET_CALL',
    default: false // turn on when gooddapp supports faucet txs
  },
  redisUrl: {
    doc: 'Redis cloud server url',
    format: String,
    env: 'REDISCLOUD_URL',
    default: ''
  },
  defenderApiKey: {
    doc: 'defender relayer api key',
    format: String,
    env: 'DEFENDER_APIKEY',
    default: ''
  },
  defenderApiSecret: {
    doc: 'defender relayer api secret',
    format: String,
    env: 'DEFENDER_APISECRET',
    default: ''
  },
  redtentPools: {
    doc: 'ubi pool by country',
    format: Object,
    env: 'REDTENT_POOLS',
    default: {}
  }
})

// Load environment dependent configuration

// network options
const networks = getNetworks()
const network = conf.get('network')

let networkId = 4447
let mainNetworkId = 4447
let celoNetworkId = 4447
let baseNetworkId = 4447

switch (network) {
  case 'fuse':
  case 'staging':
    networkId = 122
    celoNetworkId = 42220
    mainNetworkId = 11155111
    baseNetworkId = 8453
    break
  case 'production':
    networkId = 122
    celoNetworkId = 42220
    mainNetworkId = 1
    baseNetworkId = 8453
    break
  default:
    break
}

conf.set('ethereumMainnet', networks[mainNetworkId])
conf.set('ethereum', networks[networkId])
conf.set('celo', networks[celoNetworkId])
conf.set('base', networks[baseNetworkId])

// get active segmented pools
if (process.env.REDTENT_POOLS) {
  const redtentPools = JSON.parse(process.env.REDTENT_POOLS)
  conf.set('redtentPools', redtentPools)
}

// Perform validation
conf.validate({ allowed: 'strict' })

// eslint-disable-next-line
export default conf.getProperties()

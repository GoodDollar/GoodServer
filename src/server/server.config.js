import networks from './networks'

require('dotenv').config()
const convict = require('convict');
const logger = require('../imports/pino-logger').default

const log = logger.child({ from: 'server-config', level: 10 })

// Define a schema
const conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: ["production", "development", "test"],
    default: "dev-localhost",
    arg: 'nodeEnv',
    env: "NODE_ENV"
  },
  ip: {
    doc: "The IP address to bind.",
    format: "ipaddress",
    default: "127.0.0.1",
    env: "IP_ADDRESS",
  },
  port: {
    doc: "The port to bind.",
    format: "port",
    default: 3003,
    env: "PORT"
  },
  gundbPassword: {
    doc: "The password to gundb",
    format: "*",
    default: "",
    env: "GUNDB_PASS"
  },
  mnemonic: {
    doc: "Wallet mnemonic",
    format: "*",
    env: "MNEMONIC",
    default: ""
  },
  infuraKey: {
    doc: "Infura API Key",
    format: "*",
    env: "INFURA_API",
    default: ""
  },
  ethereum: {
    network_id: 42,
    httpWeb3Provider: "https://kovan.infura.io/v3/",
    websocketWeb3Provider: "wss://kovan.infura.io/ws",
  },
  network: {
    doc: "The blockchain network to connect to",
    format: ["kovan", "mainnet", "rinkbey", "ropsten","truffle","ganache","fuse"],
    default: 'kovan',
    env: "NETWORK"
  },
  plivoAuthID: {
    doc: "Plivo's authorization ID",
    format: "*",
    env: "PLIVO_AUTH_ID",
    default: ""
  },
  plivoAuthToken: {
    doc: "Plivo's authorization Token",
    format: "*",
    env: "PLIVO_AUTH_TOKEN",
    default: ""
  },
  plivoPhoneNumber: {
    doc: "Plivo's Phone Number",
    format: "*",
    env: "PLIVO_PHONE_NUMBER",
    default: ""
  }
});

// Load environment dependent configuration
const env = conf.get('env');
const network = conf.get('network');
conf.set("ethereum", networks[network]);
// Perform validation
conf.validate({ allowed: 'strict' })
// eslint-disable-next-line
log.trace("Starting configuration...", conf._instance)

export default conf.getProperties()

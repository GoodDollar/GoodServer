require('dotenv').config()
const convict = require('convict');

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
    useWebSocket: true,
    web3Transport: "HttpProvider",
    httpWeb3provider: "https://kovan.infura.io/v3/",
    websocketWeb3Provider: "wss://kovan.infura.io/ws",
    mnemonic: ""
  },
  network: {
    doc: "The blockchain network to connect to",
    format: ["kovan", "mainnet", "rinkbey", "ropsten"],
    default: 'ropsten',
    env: "NETWORK"
  }
});

// Load environment dependent configuration
const env = conf.get('env');
const network = conf.get('network');
conf.loadFile(`./config/${env}/${network}.json`);
// Perform validation
conf.validate({ allowed: 'strict' })
console.log(conf)
console.log("mnemonic:", conf.get("mnemonic"))
console.log("network:", network)
module.exports = conf.getProperties();

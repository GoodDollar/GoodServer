require('dotenv').config()
var convict = require('convict');
const logger = require('../imports/pino-logger').default

const log = logger.child({ from: 'server-config', level: 10 })

// Define a schema
var conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: ["production","development", "test"],
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
    env: "GUNDB_PASS"
  }, 
  ethereum:{
    network_id:42,
    useWebSocket:true,
    web3Transport:"HttpProvider",
    httpWeb3provider:"https://kovan.infura.io/v3/",
    websocketWeb3Provider:"wss://kovan.infura.io/ws" 
  },
  network:{
    doc: "The blockchain network to connect to",
    format: ["kovan", "mainnet","rinkbey", "ropsten"],
    value:'ropsten'
  }
});
 
// Load environment dependent configuration
var env = conf.get('env');
log.info({ env })
var network = conf.get('network');
log.info('network: ', network.value)
conf.loadFile('./config/' + env + '/dev-'+network.value+'.json');
 
// Perform validation
conf.validate({allowed: 'strict'}) 
 
module.exports = conf.getProperties();

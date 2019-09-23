const bip39 = require("bip39-light")

const IdentityABI = require('@gooddollar/goodcontracts/build/contracts/Identity.json')
const ContractsAddress = require('@gooddollar/goodcontracts/releases/deployment.json')
const get = require('lodash/get')
const web3Utils = require('web3-utils')

const Web3 = require('web3')
const HDKey = require('hdkey')
const Wallet = require('ethereumjs-wallet')
const config = {
  web3: {
    gasValue: 4000000,
    waitDelay: 1000,
  },
}
let currentProvider
let web3 = new Web3()
const getTxCount = async (from) => await web3.eth.getTransactionCount(from)
const getProvider = (provider = '') => {

  if (~provider.indexOf('wss')) {
    let p = new Web3.providers.WebsocketProvider(provider)
    return p
  }
  return new Web3.providers.HttpProvider(provider)
}
const setProvider = (provider) => {
  if (currentProvider === provider) {
    return
  } else {
    currentProvider = provider
    web3 = new Web3(getProvider(provider))
  }

}

const getAccounts = (mnemonic, numOfAccounts) => {
  const addresses = []
  const wallets = {}
  for (let i = 0; i < numOfAccounts; i++) {
    let root = HDKey.fromMasterSeed(mnemonic)
    var path = 'm/44\'/60\'/0\'/0/' + (i + 1)
    let addrNode = root.derive(path)
    let privateKeyBuffer = Buffer.from(addrNode._privateKey, 'hex')
    let wallet = Wallet.fromPrivateKey(privateKeyBuffer)
    let address = wallet.getAddressString()
    addresses.push(address)
    wallets[address] = wallet
  }
  return {
    addresses,
    wallets,
  }
}
let account
const getFirstWallet = (mnemonic) => {
  let root = HDKey.fromMasterSeed(bip39.mnemonicToSeed(mnemonic))
  const path = "m/44'/60'/0'/0/0"
  let addrNode = root.derive(path)
  account = web3.eth.accounts.privateKeyToAccount('0x' + addrNode._privateKey.toString('hex'))
  web3.eth.accounts.wallet.add(account)
  // console.log(account)
  web3.eth.defaultAccount = account.address
  address = account.address
  console.log('Initialized by mnemonic:', account.address)
  //
  //
  //
  //
  //
  // console.log('mnemonic:',mnemonic)
  // const {addresses, wallets} = getAccounts(mnemonic, 10)
  // console.log(addresses)
  // return wallets[addresses[0]]
}

let wallet
let contract
let address

const getContract = (id) => {
  console.log('----- contract address ',get(ContractsAddress, `Identity`, IdentityABI.networks[String(id)].address))

  // console.log('----- contract abi ',IdentityABI.abi)
  return new web3.eth.Contract(
    IdentityABI.abi,
    get(ContractsAddress, `fuse.Identity`, IdentityABI.networks['121'].address),
    {
      from: address,
      gas: 500000,
      gasPrice: web3Utils.toWei('1', 'gwei'),
    },
  )
}

const test = async () => {
  setProvider('http://localhost:9545')
  // getFirstWallet('drip industry pizza deny pistol stem must device citizen crowd offer now') // fuse
  // contract = getContract(121) //fuse
  getFirstWallet('myth like bonus scare over problem client lizard pioneer submit female collect') // local
  contract = getContract(4447) //local
  const params = {
    from: address,
    gas: 1000000,
    gasPrice: web3Utils.toWei('1', 'gwei'),
  }
  console.log('address', address)
  console.log('currentProvider', currentProvider)
  const batch = new web3.BatchRequest()
  let nonce = await getTxCount(address)
  console.log('nonce: ', nonce)
  batch.add(contract.methods.whiteListUser('0x919b99dcabae3fea4909af23b8dfa9f2d2c273de','ab').call.request(params,(err, res) => {
    console.log('TX 1: ',{err, res})
  }));
  batch.add(contract.methods.whiteListUser('0x919b99dcabae3fea4909af23b8dfa9f2d2c273de','ab').call.request(params,(err, res) => console.log('TX 2: ',{err, res})));
  batch.add(contract.methods.whiteListUser('0x919b99dcabae3fea4909af23b8dfa9f2d2c273de','ab').call.request(params,(err, res) => console.log('TX 3: ',{err, res})));


  // console.log(contract.methods.whiteListUser('0x54d418cce9ffbe5ddeded187b6510a78e0181e5b','ab').call.request(params,(a)=>console.log('111',a)))
  // batch.add(this.identityContract.methods.whiteListUser('0xfb5db2f6991ab80869b31c80ef65061a73ec5751', 'some string').request({from:this.address}))
  const batchResults = await batch.execute();
  console.log("FINISH: ",batchResults)
}

test().catch(e => {
  console.log('!!!!!!', e)
})



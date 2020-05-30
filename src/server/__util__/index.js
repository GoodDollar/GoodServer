import request from 'supertest'
import Web3 from 'web3'

const web3 = new Web3()

export const getCreds = async (random = false) => {
  let randomCreds = {}
  //0x7ac080f6607405705aed79675789701a48c76f55
  const creds = {
    address: '0x7ac080f6607405705aed79675789701a48c76f55',
    jwt: '',
    signature:
      '0xaa4eb02d727ab09e6621060f26cff3ceecb3a0901b4f7de564490646482ced3c1c18bf310509a0d3ef7b622c458083a2dce27b3763714bb10d82f53bdb6559a21c',
    gdSignature:
      '0xaa4eb02d727ab09e6621060f26cff3ceecb3a0901b4f7de564490646482ced3c1c18bf310509a0d3ef7b622c458083a2dce27b3763714bb10d82f53bdb6559a21c',
    profilePublickey: 'lK-f6i-QPHwyxxUOKc4uaubfpTC1TW8oLLCRmv9z9tU.CjtOQSI2XqitheQZLdVlHc09gkm_d2IRz4LRAL6GmFU',
    profileSignature:
      'SEA{"m":"Login to GoodDAPP","s":"tNknsunS9psSLQDr/nFeobeHWdROtu3kEHgjHFSkreLFkgmHJPy/E3fm6llN1QOsNtfE12WTs4k1mOEE/H1AWw=="}',
    nonce: '',
    networkId: 4447
  }
  if (random) {
    let account = web3.eth.accounts.create()
    web3.eth.accounts.wallet.add(account)
    const signature = (await web3.eth.sign('Login to GoodDAPP' + creds.nonce, account.address)).signature
    const gdSignature = signature
    randomCreds = { signature, gdSignature, address: account.address.toLowerCase() }
  }
  return { ...creds, ...randomCreds }
}

export const getToken = async (server, credentials) => {
  const creds = credentials || (await getCreds())
  return request(server)
    .post('/auth/eth')
    .send(creds)
    .expect(200)
    .then(response => response.body.token)
}

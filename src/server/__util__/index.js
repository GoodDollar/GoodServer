import request from 'supertest'
import Web3 from 'web3'
import { FV_IDENTIFIER_MSG2 } from '../login/login-middleware'

const web3 = new Web3()

const networkId = 4447

export const utmString =
  'utmcsr=twitter|utmcmd=banner|utmccn=Test_campaign_name_%3A-)|utmctr=test-term|utmcct=test-contant'

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
    profilePublickey: 'bbaareidqc4zagsioo5ae5a5fn7i4jrqjwrph5falyszrlqn5mdw7nyuduu',
    profileSignature: 'NVSvI0vg+jI0hBBo06rUSX01cE/Epvet+F21cx1Q+x5EclNiFUNKbTNgIkNQ1HVWoKVyYrIMpqWAouuK0fvtCw==',
    nonce: '',
    networkId
  }
  if (random) {
    let account = web3.eth.accounts.create()
    web3.eth.accounts.wallet.add(account)
    const signature = await web3.eth.sign('Login to GoodDAPP' + creds.nonce, account.address)
    const fvV2Identifier = await web3.eth.sign(FV_IDENTIFIER_MSG2({ account: account.address }), account.address)
    const gdSignature = signature
    randomCreds = {
      signature,
      gdSignature,
      address: account.address.toLowerCase(),
      privateKey: account.privateKey,
      fvV2Identifier,
      nonce: ''
    }
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

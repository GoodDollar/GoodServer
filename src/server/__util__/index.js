import request from 'supertest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { FV_IDENTIFIER_MSG2 } from '../utils/eth.js'

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
    const account = privateKeyToAccount(generatePrivateKey())
    const signature = await account.signMessage({ message: 'Login to GoodDAPP' + creds.nonce })
    const fvV2Identifier = await account.signMessage({
      message: FV_IDENTIFIER_MSG2({ account: account.address })
    })
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

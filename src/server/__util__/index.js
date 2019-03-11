import request from 'supertest'

export const getCreds = () => {
  const creds = {
    jwt: '',
    pubkey: '0x7ac080F6607405705AED79675789701a48C76f55',
    signature:
      '0xaa4eb02d727ab09e6621060f26cff3ceecb3a0901b4f7de564490646482ced3c1c18bf310509a0d3ef7b622c458083a2dce27b3763714bb10d82f53bdb6559a21c'
  }
  return creds
}

export const getToken = (server, credentials) => {
  const creds = credentials || getCreds()
  return request(server)
    .post('/auth/eth')
    .send(creds)
    .expect(200)
    .then(response => response.body.token)
}

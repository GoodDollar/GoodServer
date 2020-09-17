const Gun = require('gun')
const SEA = require('gun/sea')
const delay = require('delay')
const startServer = () => {
  const Gun = require('gun')
  const SEA = require('gun/sea')

  const http = require('http')

  const server = http.createServer().listen(8765)

  let gunConfig = {
    web: server
  }

  Gun(gunConfig)

  console.log('Relay peer started on port ' + 8765 + ' with /gun')
}
const startClient = () => {
  const gun = Gun({ file: 'radataclient', peers: ['http://localhost:8765/gun'] })
  const test = async () => {
    const exists = await gun.get('~@gooddollarorg').then()
    console.log({ exists })
    const create = () => gun.user().create('gooddollarorg', 'password', auth)
    const auth = () => gun.user().auth('gooddollarorg', 'password', console.log)
    if (exists) auth()
    else create()
  }
  test()
}
startServer()
delay(1000)
startClient()

// @flow
import queueMongo from '../tx-manager/queueMongo'
import WalletNonce from '../../db/mongo/models/wallet-nonce'
import conf from '../../server.config'
let txManagerMongo

const prefixTestAddress = 'test'

jest.setTimeout(3000000)

describe('tx manager only for mongo', () => {
  if (conf.enableMongoLock) {
    beforeAll(async () => {
      txManagerMongo = new queueMongo()
    })

    afterAll(async () => {
      await WalletNonce.deleteMany({ address: new RegExp(prefixTestAddress, 'i') })
    })

    test('txManagerMongo - queue nonce release', async () => {
      const testAddress = `${prefixTestAddress} - ${Date.now()}`

      for (let i = 0; i < 5; i++) {
        const { nonce, release } = await txManagerMongo.lock([testAddress])

        release()

        await expect(nonce === i).toBeTruthy()
      }
    })

    test('txManagerMongo - queue nonce fail', async () => {
      const testAddress = `${prefixTestAddress} - ${Date.now()}`

      for (let i = 0; i < 5; i++) {
        const { nonce, fail } = await txManagerMongo.lock([testAddress])

        fail()

        await expect(nonce === 0).toBeTruthy()
      }
    })

    test('txManagerMongo - queue nonce fail/release', async () => {
      const testAddress = `${prefixTestAddress} - ${Date.now()}`
      let nowNetNonce = 0

      for (let i = 0; i < 10; i++) {
        const { nonce, release, fail } = await txManagerMongo.lock([testAddress])

        if (i % 2 === 0) {
          release()
        } else {
          fail()
        }
        nowNetNonce = nonce
      }

      await expect(nowNetNonce === 5).toBeTruthy()
    })
  } else {
    test('txManagerMongo - admin lock disabled ', async () => {
      await expect(conf.adminLockEnable).not.toBeTruthy()
    })
  }
})

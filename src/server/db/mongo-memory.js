import { MongoMemoryReplSet } from 'mongodb-memory-server'

const replSet = new MongoMemoryReplSet({
  replSet: { storageEngine: 'wiredTiger' }
})

export const getMongoMemoryServerConnectionString = async () => {
  await replSet.waitUntilRunning()
  return await replSet.getConnectionString()
}

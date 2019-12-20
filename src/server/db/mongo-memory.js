import { MongoMemoryServer } from 'mongodb-memory-server'

const mongoServer = new MongoMemoryServer()

export const getMongoMemoryServerConnectionString = () => mongoServer.getConnectionString()

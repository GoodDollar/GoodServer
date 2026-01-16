/**
 * Shared MongoDB mock for Jest tests
 *
 * This mock prevents MongoDB connections during tests by providing mock implementations
 * of mongoose, Schema, and model methods.
 *
 * Usage in test files:
 *   // At the top of your test file, before any imports
 *   jest.mock('../../db/mongo-db')
 *
 * This will automatically use this mock file when the mongo-db module is imported.
 *
 * Why this is needed:
 * - Even when enableMongoLock is false, queueMongo is still imported in tx-manager.js
 * - The import chain triggers mongo-db.js which calls mongoose.connect() at module load time
 * - This mock prevents the actual connection attempt
 */

// Create a mock Schema constructor
class MockSchema {
  constructor(definition) {
    this.definition = definition
    this.indexes = []
  }
  index(fields, options) {
    this.indexes.push({ fields, options })
    return this
  }
}

// Create a mock model function
const models = {}
// eslint-disable-next-line no-unused-vars
const mockModel = jest.fn((name, schema) => {
  if (!models[name]) {
    models[name] = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      watch: jest.fn(() => ({
        on: jest.fn()
      })),
      deleteMany: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    }
  }
  return models[name]
})

const mockMongoose = {
  connect: jest.fn(() => Promise.resolve(mockMongoose)),
  set: jest.fn(),
  Schema: MockSchema,
  Types: {
    ObjectId: jest.fn()
  },
  model: mockModel,
  connection: {
    readyState: 0,
    on: jest.fn(),
    once: jest.fn(),
    asPromise: jest.fn(() => Promise.resolve())
  }
}

export const Schema = MockSchema
export const Types = mockMongoose.Types
export default mockMongoose

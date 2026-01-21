import dns from 'dns'
dns.setDefaultResultOrder('ipv4first') //required for resolving correctly localhost
jest.setTimeout(30000) // in milliseconds

// Global teardown to ensure async operations (like AWS SDK calls) complete before Jest tears down
afterAll(async () => {
  // Wait for any pending async operations to complete
  // This helps prevent "Jest environment torn down" errors from AWS SDK
  await new Promise(resolve => setTimeout(resolve, 2000))
})

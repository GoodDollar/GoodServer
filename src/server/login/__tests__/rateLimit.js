import request from 'supertest'
import mongoose from '../../db/mongo-db'
import startApp from '../../app'
import { getCreds } from '../../__util__'

describe('login routes rate limiting', () => {
  let app
  let creds

  beforeAll(async () => {
    jest.setTimeout(50000)
    // supertest binds its own ephemeral port, avoiding clashes with suites that listen on the fixed test port
    app = await startApp()
    await mongoose.connection.asPromise()
    creds = await getCreds()
  })

  test('/auth/eth accepts a valid login', async () => {
    const res = await request(app).post('/auth/eth').send(creds)

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })

  test.each(['/auth/eth', '/auth/fv', '/auth/fv2'])('%s is rate limited', async route => {
    // empty bodies are rejected by the handler; we only care that the limiter kicks in after the quota
    const statuses = []

    for (let i = 0; i < 35; i++) {
      const res = await request(app).post(route).send({})
      statuses.push(res.status)
    }

    expect(statuses).toContain(429)
    expect(statuses.slice(0, 5)).not.toContain(429)
  })
  test('rotating X-Forwarded-For does not evade the limit', async () => {
    const statuses = []

    for (let i = 0; i < 35; i++) {
      const res = await request(app)
        .post('/auth/fv2')
        .set('X-Forwarded-For', `10.0.0.${i + 1}`)
        .send({})
      statuses.push(res.status)
    }

    expect(statuses).toContain(429)
  })
})

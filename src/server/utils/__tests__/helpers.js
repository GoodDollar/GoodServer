// @flow
import { onlyInEnv } from '../helpers'
import MockExpressRequest from 'mock-express-request'
import MockExpressResponse from 'mock-express-response'

describe('storageAPI', () => {
  test('use onlyProd should return {ok:1, onlyInEnv: {current: "test", onlyIn: ["production"]}}', done => {
    const onlyProd = onlyInEnv('production')
    const response = {
      ...new MockExpressResponse(),
      json: data => {
        expect(data).toEqual({ ok: 1, onlyInEnv: { current: 'test', onlyIn: ['production'] } })
        done()
      }
    }
    const req = new MockExpressRequest()
    const next = () => null
    onlyProd(req, response, next)
  })

  test('use onlyTest should execute next', done => {
    const onlyTest = onlyInEnv('test')
    const response = new MockExpressResponse()
    const req = new MockExpressRequest()
    const next = () => {
      done()
    }
    onlyTest(req, response, next)
  })

  test('use onlyProdAndTest should execute next', done => {
    const onlyProdAndTest = onlyInEnv('production', 'test')
    const response = new MockExpressResponse()
    const req = new MockExpressRequest()
    const next = () => {
      done()
    }
    onlyProdAndTest(req, response, next)
  })
})

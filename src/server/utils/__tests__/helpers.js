// @flow
import { onlyInEnv } from '../helpers'
import MockExpressRequest from 'mock-express-request'
import MockExpressResponse from 'mock-express-response'
import type { $Request, $Response, NextFunction } from 'express'

describe('storageAPI', () => {
  let onlyTest, onlyProd, onlyProdAndTest
  beforeAll(() => {
    onlyTest = onlyInEnv('test')
    onlyProd = onlyInEnv('production')
    onlyProdAndTest = onlyInEnv('production', 'test')
  })

  test('use onlyProd should return {ok:1}', done => {
    const response: $Response = {
      ...new MockExpressResponse(),
      json: data => {
        expect(data).toEqual({ ok: 1 })
        done()
      }
    }
    const req: $Request = new MockExpressRequest()
    const next: NextFunction = () => null
    onlyProd(req, response, next)
  })

  test('use onlyTest should execute next', done => {
    const response: $Response = new MockExpressResponse()
    const req: $Request = new MockExpressRequest()
    const next: NextFunction = () => {
      done()
    }
    onlyProdAndTest(req, response, next)
  })

  test('use onlyProdAndTest should execute next', done => {
    const response: $Response = new MockExpressResponse()
    const req: $Request = new MockExpressRequest()
    const next: NextFunction = () => {
      done()
    }
    onlyTest(req, response, next)
  })
})

import FailOpenStore from '../failOpenStore'

describe('FailOpenStore', () => {
  const logger = { error: jest.fn() }

  const makeStore = overrides => ({
    increment: jest.fn().mockResolvedValue({ totalHits: 5, resetTime: new Date(0) }),
    decrement: jest.fn().mockResolvedValue(undefined),
    resetKey: jest.fn().mockResolvedValue(undefined),
    init: jest.fn(),
    ...overrides
  })

  beforeEach(() => jest.clearAllMocks())

  test('delegates to the wrapped store when it works', async () => {
    const inner = makeStore()
    const store = new FailOpenStore(inner, logger)

    await expect(store.increment('k')).resolves.toEqual({ totalHits: 5, resetTime: new Date(0) })
    await store.decrement('k')
    await store.resetKey('k')

    expect(inner.decrement).toHaveBeenCalledWith('k')
    expect(inner.resetKey).toHaveBeenCalledWith('k')
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('lets the request through when increment fails', async () => {
    const store = new FailOpenStore(
      makeStore({ increment: jest.fn().mockRejectedValue(new Error('redis down')) }),
      logger
    )
    store.init({ windowMs: 120000 })

    const { totalHits, resetTime } = await store.increment('k')

    expect(totalHits).toBe(1)
    expect(resetTime.getTime()).toBeGreaterThan(Date.now())
    expect(logger.error).toHaveBeenCalled()
  })

  test('swallows decrement and resetKey errors', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('redis down'))
    const store = new FailOpenStore(makeStore({ decrement: failing, resetKey: failing }), logger)

    await expect(store.decrement('k')).resolves.toBeUndefined()
    await expect(store.resetKey('k')).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  test('forwards init options to the wrapped store', () => {
    const inner = makeStore()

    new FailOpenStore(inner, logger).init({ windowMs: 1000 })

    expect(inner.init).toHaveBeenCalledWith({ windowMs: 1000 })
  })
})

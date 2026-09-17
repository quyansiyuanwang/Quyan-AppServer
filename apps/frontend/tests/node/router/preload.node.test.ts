import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRoutePreloadStateForTests, preloadRouteLocation, preloadRouteComponents } from '@/router/preload'

const createLoader = () => vi.fn(async () => ({ default: {} }))

const createRouterMock = () => {
  const homeLoader = createLoader()
  const chatLoader = createLoader()
  const loginLoader = createLoader()
  const notFoundLoader = createLoader()

  const homeRecord = {
    path: '/home',
    meta: {},
    redirect: undefined,
    components: { default: homeLoader },
  }
  const chatRecord = {
    path: '/chat',
    meta: {},
    redirect: undefined,
    components: { default: chatLoader },
  }
  const loginRecord = {
    path: '/login',
    meta: { isAuthEntry: true },
    redirect: undefined,
    components: { default: loginLoader },
  }
  const notFoundRecord = {
    path: '/:catchAll(.*)',
    meta: {},
    redirect: undefined,
    components: { default: notFoundLoader },
  }

  const resolve = vi.fn((target: unknown) => {
    if (typeof target === 'string' && target === '/chat') {
      return {
        name: 'chat',
        matched: [chatRecord],
      }
    }

    return {
      name: 'home',
      matched: [homeRecord],
    }
  })

  const getRoutes = vi.fn(() => [homeRecord, chatRecord, loginRecord, notFoundRecord])

  return {
    router: {
      resolve,
      getRoutes,
    },
    homeLoader,
    chatLoader,
    loginLoader,
    notFoundLoader,
  }
}

describe('router preload helpers', () => {
  beforeEach(() => {
    __resetRoutePreloadStateForTests()
    vi.clearAllMocks()
  })

  it('preloads the resolved target route before navigation', async () => {
    const { router, chatLoader, homeLoader } = createRouterMock()

    await preloadRouteLocation(router as never, '/chat')

    expect(chatLoader).toHaveBeenCalledTimes(1)
    expect(homeLoader).not.toHaveBeenCalled()
  })
  it('retries a failed loader and shares concurrent requests for all named views', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('chunk unavailable')).mockResolvedValue({ default: {} })
    const named = createLoader()
    const records = [{ components: { default: loader, sidebar: named } }] as never
    await Promise.all([preloadRouteComponents(records), preloadRouteComponents(records)])
    expect(loader).toHaveBeenCalledOnce()
    await preloadRouteComponents(records)
    expect(loader).toHaveBeenCalledTimes(2)
    expect(named).toHaveBeenCalledOnce()
  })

})

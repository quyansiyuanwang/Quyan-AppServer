import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { NotificationService } from '@/service/notificationService'

const expectOperation = (name: string) => expect.objectContaining({ name })

// Helper: build a successful API response envelope
const ok = <T>(data: T) => ({ code: CustomCode.OK, message: 'ok', data })
// Helper: build a failed API response envelope
const fail = (message = 'Server error') => ({ code: 500, message })

describe('NotificationService', () => {
  let service: NotificationService

  beforeEach(() => {
    vi.clearAllMocks()
    ;(NotificationService as any).instance = undefined
    service = NotificationService.getInstance()
  })

  // ─── Singleton ──────────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('getInstance 应返回同一实例', () => {
      const a = NotificationService.getInstance()
      const b = NotificationService.getInstance()
      expect(a).toBe(b)
    })
  })

  // ─── getPreferences ─────────────────────────────────────────────────────────

  describe('getPreferences()', () => {
    it('应调用正确的 operationId 并返回响应', async () => {
      const prefData = { id: 'pref-1', subscribedEvents: [], cooldownMinutes: 60 }
      requestMock.get.mockResolvedValue(ok(prefData))

      const result = await service.getPreferences()

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerGetPreferences'),
        {},
        undefined,
      )
      expect(result.data).toEqual(prefData)
    })

    it('API 失败时应抛出错误', async () => {
      requestMock.get.mockResolvedValue(fail('Unauthorized'))

      await expect(service.getPreferences()).rejects.toThrow()
    })
  })

  // ─── updatePreferences ──────────────────────────────────────────────────────

  describe('updatePreferences()', () => {
    it('应以 body 调用 PUT 并返回响应', async () => {
      const dto = { cooldownMinutes: 30, subscribedEvents: ['balance_low'] }
      const prefData = { id: 'pref-1', cooldownMinutes: 30 }
      requestMock.put.mockResolvedValue(ok(prefData))

      const result = await service.updatePreferences(dto as any)

      expect(requestMock.put).toHaveBeenCalledWith(
        expectOperation('NotificationControllerUpdatePreferences'),
        {
          body: dto,
        },
        undefined,
      )
      expect(result.data).toEqual(prefData)
    })

    it('空 body 时应仍然发送请求', async () => {
      requestMock.put.mockResolvedValue(ok({}))

      await service.updatePreferences({})

      expect(requestMock.put).toHaveBeenCalledWith(
        expectOperation('NotificationControllerUpdatePreferences'),
        {
          body: {},
        },
        undefined,
      )
    })
  })

  // ─── listWebhooks ───────────────────────────────────────────────────────────

  describe('listWebhooks()', () => {
    it('应调用正确的 operationId 并返回 webhook 列表', async () => {
      const webhooks = [{ id: 'wh-1', name: 'My Hook' }]
      requestMock.get.mockResolvedValue(ok(webhooks))

      const result = await service.listWebhooks()

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerListWebhooks'),
        {},
        undefined,
      )
      expect(result.data).toEqual(webhooks)
    })
  })

  // ─── createWebhook ──────────────────────────────────────────────────────────

  describe('createWebhook()', () => {
    it('应以 body 调用 POST 并返回新 webhook', async () => {
      const dto = { name: 'Hook', url: 'https://example.com/hook', format: 'generic' }
      const created = { id: 'wh-2', ...dto }
      requestMock.post.mockResolvedValue(ok(created))

      const result = await service.createWebhook(dto as any)

      expect(requestMock.post).toHaveBeenCalledWith(
        expectOperation('NotificationControllerCreateWebhook'),
        {
          body: dto,
        },
        undefined,
      )
      expect(result.data).toEqual(created)
    })
  })

  // ─── updateWebhook ──────────────────────────────────────────────────────────

  describe('updateWebhook()', () => {
    it('应以 path.id 和 body 调用 PUT', async () => {
      const dto = { name: 'Updated', enabled: false }
      const updated = { id: 'wh-1', ...dto }
      requestMock.put.mockResolvedValue(ok(updated))

      const result = await service.updateWebhook('wh-1', dto as any)

      expect(requestMock.put).toHaveBeenCalledWith(
        expectOperation('NotificationControllerUpdateWebhook'),
        {
          path: { id: 'wh-1' },
          body: dto,
        },
        undefined,
      )
      expect(result.data).toEqual(updated)
    })

    it('不同 id 应传入正确的 path.id', async () => {
      requestMock.put.mockResolvedValue(ok({ id: 'wh-99' }))

      await service.updateWebhook('wh-99', {})

      expect(requestMock.put).toHaveBeenCalledWith(
        expectOperation('NotificationControllerUpdateWebhook'),
        expect.objectContaining({ path: { id: 'wh-99' } }),
        undefined,
      )
    })
  })

  // ─── deleteWebhook ──────────────────────────────────────────────────────────

  describe('deleteWebhook()', () => {
    it('应以 path.id 调用 DELETE', async () => {
      requestMock.delete.mockResolvedValue({ code: CustomCode.OK, message: 'ok' })

      await service.deleteWebhook('wh-1')

      expect(requestMock.delete).toHaveBeenCalledWith(
        expectOperation('NotificationControllerDeleteWebhook'),
        {
          path: { id: 'wh-1' },
        },
        undefined,
      )
    })

    it('requireData=false 时即使无 data 也不应抛出', async () => {
      requestMock.delete.mockResolvedValue({ code: CustomCode.OK, message: 'ok' })

      await expect(service.deleteWebhook('wh-1')).resolves.not.toThrow()
    })

    it('API 失败时应抛出错误', async () => {
      requestMock.delete.mockResolvedValue(fail('Not found'))

      await expect(service.deleteWebhook('wh-999')).rejects.toThrow()
    })
  })

  // ─── testWebhook ────────────────────────────────────────────────────────────

  describe('testWebhook()', () => {
    it('应以 path.id 调用 POST /test', async () => {
      requestMock.post.mockResolvedValue(ok({ success: true }))

      const result = await service.testWebhook('wh-1')

      expect(requestMock.post).toHaveBeenCalledWith(
        expectOperation('NotificationControllerTestWebhook'),
        {
          path: { id: 'wh-1' },
        },
        undefined,
      )
      expect(result.data).toEqual({ success: true })
    })

    it('测试失败时 data.success 应为 false', async () => {
      requestMock.post.mockResolvedValue(ok({ success: false, error: 'Connection refused' }))

      const result = await service.testWebhook('wh-1')

      expect(result.data?.success).toBe(false)
      expect(result.data?.error).toBe('Connection refused')
    })
  })

  // ─── getLogs ────────────────────────────────────────────────────────────────

  describe('getLogs()', () => {
    it('应以 params 传入 page 和 pageSize', async () => {
      const logsData = { logs: [], total: 0, page: 1, pageSize: 20 }
      requestMock.get.mockResolvedValue(ok(logsData))

      const result = await service.getLogs(1, 20)

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerGetLogs'),
        {
          params: { page: 1, pageSize: 20 },
        },
        undefined,
      )
      expect(result.data).toEqual(logsData)
    })

    it('默认参数应为 page=1, pageSize=20', async () => {
      requestMock.get.mockResolvedValue(ok({ logs: [], total: 0, page: 1, pageSize: 20 }))

      await service.getLogs()

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerGetLogs'),
        {
          params: { page: 1, pageSize: 20 },
        },
        undefined,
      )
    })

    it('自定义分页参数应正确传入', async () => {
      requestMock.get.mockResolvedValue(ok({ logs: [], total: 50, page: 3, pageSize: 10 }))

      await service.getLogs(3, 10)

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerGetLogs'),
        {
          params: { page: 3, pageSize: 10 },
        },
        undefined,
      )
    })
  })

  // ─── getEventList ────────────────────────────────────────────────────────────

  describe('getEventList()', () => {
    it('应调用正确的 operationId 并返回事件列表', async () => {
      const events = [
        { value: 'balance_low', label: '余额不足', hasThreshold: true, thresholdUnit: '元' },
      ]
      requestMock.get.mockResolvedValue(ok(events))

      const result = await service.getEventList()

      expect(requestMock.get).toHaveBeenCalledWith(
        expectOperation('NotificationControllerGetEventList'),
        {},
        undefined,
      )
      expect(result.data).toEqual(events)
    })
  })

  // ─── 错误处理 ────────────────────────────────────────────────────────────────

  describe('错误处理', () => {
    it('requireData=true 且 data 为 null 时应抛出错误', async () => {
      requestMock.get.mockResolvedValue({ code: CustomCode.OK, message: 'ok', data: null })

      await expect(service.getPreferences()).rejects.toThrow()
    })

    it('2FA 要求时不应抛出（checkApiResult 特殊处理）', async () => {
      const twoFaResponse = { code: CustomCode.TWO_FACTOR_REQUIRED, message: '2FA required' }
      requestMock.get.mockResolvedValue(twoFaResponse)

      const result = await service.getPreferences()

      expect(result).toEqual(twoFaResponse)
    })
  })
})

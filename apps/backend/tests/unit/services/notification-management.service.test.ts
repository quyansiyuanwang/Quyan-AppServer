import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationManagementService } from "../../../src/services/notification/notification-management.service";
import { NotificationPreferenceRepository } from "../../../src/store/notification/notification-preference.repository";
import { NotificationService } from "../../../src/services/notification/notification.service";
import { NotificationPreferenceInitializerService } from "../../../src/services/notification/notification-preference-initializer.service";
import BusinessLogService from "../../../src/services/system/businesslog.service";
import { NotificationEvent, ALL_NOTIFICATION_EVENTS, THRESHOLD_EVENTS } from "../../../src/constant/notification-event";
import { NotFoundError } from "../../../src/util/errors";
import type { Request } from "express";

vi.mock("../../../src/store/notification/notification-preference.repository");
vi.mock("../../../src/services/notification/notification.service");
vi.mock("../../../src/services/notification/notification-preference-initializer.service");
vi.mock("../../../src/services/system/businesslog.service");

const repoMock = {
  findByUserId: vi.fn(),
  upsertPreference: vi.fn(),
  ensurePreferenceExists: vi.fn(),
  findWebhooksByUserId: vi.fn(),
  findWebhookById: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  findLogsByUserId: vi.fn(),
};

const notifServiceMock = {
  sendWebhook: vi.fn(),
};

const initializerMock = {
  getOrInitialize: vi.fn(),
};

const bizLogMock = {
  logOperation: vi.fn(),
};

const mockRequest = {
  headers: { "x-request-id": "req-123", "user-agent": "test-agent" },
  ip: "127.0.0.1",
  socket: { remoteAddress: "127.0.0.1" },
} as unknown as Request;

const makePreferenceRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "pref-1",
  userId: "user-1",
  notificationEmail: "user@example.com",
  subscribedEvents: [NotificationEvent.BALANCE_LOW],
  knownEvents: [...ALL_NOTIFICATION_EVENTS],
  thresholds: { balance_low: 10 },
  cooldownMinutes: 60,
  createTime: new Date("2026-01-01"),
  updateTime: new Date("2026-01-02"),
  ...overrides,
});

const makeWebhookRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "wh-1",
  userId: "user-1",
  preferenceId: "pref-1",
  name: "My Hook",
  url: "https://example.com/hook",
  format: "generic",
  secret: null,
  enabled: true,
  status: 1,
  createTime: new Date("2026-01-01"),
  updateTime: new Date("2026-01-02"),
  ...overrides,
});

describe("NotificationManagementService", () => {
  let service: NotificationManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(NotificationPreferenceRepository, "getInstance").mockReturnValue(
      repoMock as unknown as NotificationPreferenceRepository,
    );
    vi.spyOn(NotificationService, "getInstance").mockReturnValue(notifServiceMock as unknown as NotificationService);
    vi.spyOn(NotificationPreferenceInitializerService, "getInstance").mockReturnValue(
      initializerMock as unknown as NotificationPreferenceInitializerService,
    );
    vi.spyOn(BusinessLogService, "getInstance").mockReturnValue(bizLogMock as unknown as BusinessLogService);
    (NotificationManagementService as any).instance = undefined;
    service = new (NotificationManagementService as any)(repoMock, notifServiceMock, initializerMock, bizLogMock);
    bizLogMock.logOperation.mockResolvedValue(undefined);
  });

  // ─── getPreference ──────────────────────────────────────────────────────────

  describe("getPreference()", () => {
    it("用户有偏好时应返回 DTO", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreferenceRecord());

      const result = await service.getPreference("user-1");

      expect(result.id).toBe("pref-1");
      expect(result.notificationEmail).toBe("user@example.com");
      expect(result.subscribedEvents).toContain(NotificationEvent.BALANCE_LOW);
      expect(result.cooldownMinutes).toBe(60);
      expect(result.createTime).toBe("2026-01-01T00:00:00.000Z");
    });

    it("用户无偏好时应初始化默认偏好", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(
        makePreferenceRecord({
          notificationEmail: "seed@example.com",
          subscribedEvents: [NotificationEvent.TICKET_STATUS_UPDATED],
        }),
      );

      const result = await service.getPreference("user-1");

      expect(initializerMock.getOrInitialize).toHaveBeenCalledWith("user-1");
      expect(result.notificationEmail).toBe("seed@example.com");
      expect(result.subscribedEvents).toEqual([NotificationEvent.TICKET_STATUS_UPDATED]);
      expect(result.cooldownMinutes).toBe(60);
    });
  });

  // ─── updatePreference ───────────────────────────────────────────────────────

  describe("updatePreference()", () => {
    it("应调用 upsertPreference 并返回更新后的 DTO", async () => {
      repoMock.upsertPreference.mockResolvedValue(makePreferenceRecord({ notificationEmail: "new@example.com" }));

      const result = await service.updatePreference("user-1", { notificationEmail: "new@example.com" }, mockRequest);

      expect(repoMock.upsertPreference).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ notificationEmail: "new@example.com" }),
      );
      expect(result.notificationEmail).toBe("new@example.com");
    });

    it("应记录业务日志", async () => {
      repoMock.upsertPreference.mockResolvedValue(makePreferenceRecord());

      await service.updatePreference("user-1", {}, mockRequest);

      expect(bizLogMock.logOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "user-1",
          targetResourceType: "NotificationPreference",
          success: true,
        }),
      );
    });

    it("只传入部分字段时 updateData 不应包含未传字段", async () => {
      repoMock.upsertPreference.mockResolvedValue(makePreferenceRecord());

      await service.updatePreference("user-1", { cooldownMinutes: 30 }, mockRequest);

      const [, updateData] = repoMock.upsertPreference.mock.calls[0];
      expect(updateData).not.toHaveProperty("notificationEmail");
      expect(updateData).not.toHaveProperty("knownEvents");
      expect(updateData.cooldownMinutes).toBe(30);
    });

    it("应保留显式取消后的空订阅列表", async () => {
      repoMock.upsertPreference.mockResolvedValue(makePreferenceRecord({ subscribedEvents: [] }));

      const result = await service.updatePreference(
        "user-1",
        { subscribedEvents: [] },
        mockRequest,
      );

      expect(repoMock.upsertPreference).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          subscribedEvents: [],
          knownEvents: [...ALL_NOTIFICATION_EVENTS],
        }),
      );
      expect(result.subscribedEvents).toEqual([]);
    });
  });

  // ─── listWebhooks ───────────────────────────────────────────────────────────

  describe("listWebhooks()", () => {
    it("应返回 webhook DTO 数组", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhookRecord()]);

      const result = await service.listWebhooks("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("wh-1");
      expect(result[0].name).toBe("My Hook");
      expect(result[0].hasSecret).toBe(false);
    });

    it("有 secret 时 hasSecret 应为 true，且不暴露 secret 值", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhookRecord({ secret: "super-secret" })]);

      const result = await service.listWebhooks("user-1");

      expect(result[0].hasSecret).toBe(true);
      expect(result[0]).not.toHaveProperty("secret");
    });

    it("无 webhook 时应返回空数组", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([]);
      expect(await service.listWebhooks("user-1")).toEqual([]);
    });
  });

  // ─── createWebhook ──────────────────────────────────────────────────────────

  describe("createWebhook()", () => {
    it("应调用初始化器和 createWebhook", async () => {
      initializerMock.getOrInitialize.mockResolvedValue({ id: "pref-1" });
      repoMock.createWebhook.mockResolvedValue(makeWebhookRecord());

      const result = await service.createWebhook(
        "user-1",
        { name: "My Hook", url: "https://example.com/hook", format: "generic" },
        mockRequest,
      );

      expect(initializerMock.getOrInitialize).toHaveBeenCalledWith("user-1");
      expect(repoMock.createWebhook).toHaveBeenCalledWith(
        "user-1",
        "pref-1",
        expect.objectContaining({ name: "My Hook", url: "https://example.com/hook" }),
      );
      expect(result.id).toBe("wh-1");
    });

    it("dto.enabled 未传时应默认为 true", async () => {
      initializerMock.getOrInitialize.mockResolvedValue({ id: "pref-1" });
      repoMock.createWebhook.mockResolvedValue(makeWebhookRecord());

      await service.createWebhook("user-1", { name: "Hook", url: "https://x.com", format: "slack" }, mockRequest);

      const [, , createData] = repoMock.createWebhook.mock.calls[0];
      expect(createData.enabled).toBe(true);
    });

    it("dto.secret 未传时应为 null", async () => {
      initializerMock.getOrInitialize.mockResolvedValue({ id: "pref-1" });
      repoMock.createWebhook.mockResolvedValue(makeWebhookRecord());

      await service.createWebhook("user-1", { name: "Hook", url: "https://x.com", format: "discord" }, mockRequest);

      const [, , createData] = repoMock.createWebhook.mock.calls[0];
      expect(createData.secret).toBeNull();
    });

    it("应记录业务日志", async () => {
      initializerMock.getOrInitialize.mockResolvedValue({ id: "pref-1" });
      repoMock.createWebhook.mockResolvedValue(makeWebhookRecord());

      await service.createWebhook("user-1", { name: "Hook", url: "https://x.com", format: "generic" }, mockRequest);

      expect(bizLogMock.logOperation).toHaveBeenCalledWith(
        expect.objectContaining({ targetResourceType: "NotificationWebhook", success: true }),
      );
    });
  });

  // ─── updateWebhook ──────────────────────────────────────────────────────────

  describe("updateWebhook()", () => {
    it("webhook 不存在时应抛出 NotFoundError", async () => {
      repoMock.findWebhookById.mockResolvedValue(null);

      await expect(service.updateWebhook("wh-999", "user-1", { name: "New" }, mockRequest)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("webhook 存在时应更新并返回 DTO", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      repoMock.updateWebhook.mockResolvedValue(makeWebhookRecord({ name: "Updated" }));

      const result = await service.updateWebhook("wh-1", "user-1", { name: "Updated" }, mockRequest);

      expect(result.name).toBe("Updated");
      expect(bizLogMock.logOperation).toHaveBeenCalled();
    });

    it("只传入部分字段时 updateData 不应包含未传字段", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      repoMock.updateWebhook.mockResolvedValue(makeWebhookRecord());

      await service.updateWebhook("wh-1", "user-1", { enabled: false }, mockRequest);

      const [, , updateData] = repoMock.updateWebhook.mock.calls[0];
      expect(updateData).not.toHaveProperty("name");
      expect(updateData.enabled).toBe(false);
    });
  });

  // ─── deleteWebhook ──────────────────────────────────────────────────────────

  describe("deleteWebhook()", () => {
    it("webhook 不存在时应抛出 NotFoundError", async () => {
      repoMock.findWebhookById.mockResolvedValue(null);

      await expect(service.deleteWebhook("wh-999", "user-1", mockRequest)).rejects.toThrow(NotFoundError);
    });

    it("webhook 存在时应调用 deleteWebhook 并记录日志", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      repoMock.deleteWebhook.mockResolvedValue(undefined);

      await service.deleteWebhook("wh-1", "user-1", mockRequest);

      expect(repoMock.deleteWebhook).toHaveBeenCalledWith("wh-1", "user-1");
      expect(bizLogMock.logOperation).toHaveBeenCalledWith(
        expect.objectContaining({ targetResourceId: "wh-1", success: true }),
      );
    });
  });

  // ─── testWebhook ────────────────────────────────────────────────────────────

  describe("testWebhook()", () => {
    it("webhook 不存在时应抛出 NotFoundError", async () => {
      repoMock.findWebhookById.mockResolvedValue(null);

      await expect(service.testWebhook("wh-999", "user-1")).rejects.toThrow(NotFoundError);
    });

    it("sendWebhook 成功时应返回 { success: true }", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      notifServiceMock.sendWebhook.mockResolvedValue(undefined);

      const result = await service.testWebhook("wh-1", "user-1");

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("sendWebhook 失败时应返回 { success: false, error: message }", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      notifServiceMock.sendWebhook.mockRejectedValue(new Error("Connection refused"));

      const result = await service.testWebhook("wh-1", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("测试时应使用 BALANCE_LOW 事件和测试内容", async () => {
      repoMock.findWebhookById.mockResolvedValue(makeWebhookRecord());
      notifServiceMock.sendWebhook.mockResolvedValue(undefined);

      await service.testWebhook("wh-1", "user-1");

      expect(notifServiceMock.sendWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wh-1" }),
        NotificationEvent.BALANCE_LOW,
        expect.objectContaining({ title: expect.stringContaining("测试") }),
      );
    });
  });

  // ─── getLogs ────────────────────────────────────────────────────────────────

  describe("getLogs()", () => {
    it("应返回分页日志 DTO", async () => {
      repoMock.findLogsByUserId.mockResolvedValue({
        logs: [
          {
            id: "log-1",
            eventType: NotificationEvent.BALANCE_LOW,
            title: "余额不足",
            content: "内容",
            channel: "email",
            webhookId: null,
            deliveryStatus: "success",
            errorMessage: null,
            createTime: new Date("2026-01-01"),
          },
        ],
        total: 1,
      });

      const result = await service.getLogs("user-1", 1, 20);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.logs[0].id).toBe("log-1");
      expect(result.logs[0].createTime).toBe("2026-01-01T00:00:00.000Z");
    });

    it("webhookId 为 null 时 DTO 中应为 null", async () => {
      repoMock.findLogsByUserId.mockResolvedValue({
        logs: [
          {
            id: "log-2",
            eventType: NotificationEvent.ABNORMAL_LOGIN,
            title: "异常登录",
            content: "内容",
            channel: "email",
            webhookId: null,
            deliveryStatus: "failed",
            errorMessage: "SMTP error",
            createTime: new Date(),
          },
        ],
        total: 1,
      });

      const result = await service.getLogs("user-1", 1, 20);
      expect(result.logs[0].webhookId).toBeNull();
      expect(result.logs[0].errorMessage).toBe("SMTP error");
    });
  });

  // ─── getEventList ───────────────────────────────────────────────────────────

  describe("getEventList()", () => {
    it("应返回所有事件", () => {
      const list = service.getEventList();
      expect(list).toHaveLength(ALL_NOTIFICATION_EVENTS.length);
    });

    it("THRESHOLD_EVENTS 中的事件 hasThreshold 应为 true", () => {
      const list = service.getEventList();
      for (const event of THRESHOLD_EVENTS) {
        const item = list.find((e) => e.value === event);
        expect(item?.hasThreshold).toBe(true);
      }
    });

    it("非阈值事件 hasThreshold 应为 false", () => {
      const list = service.getEventList();
      const nonThreshold = list.filter((e) => !(THRESHOLD_EVENTS as readonly string[]).includes(e.value));
      for (const item of nonThreshold) expect(item.hasThreshold).toBe(false);
    });

    it("BALANCE_LOW 的 thresholdUnitI18nKey 应存在", () => {
      const list = service.getEventList();
      const item = list.find((e) => e.value === NotificationEvent.BALANCE_LOW);
      expect(item?.thresholdUnitI18nKey).toBe("notificationEventThresholdUnit.balance_low");
    });

    it("MONTHLY_PASS_QUOTA_LOW 的 thresholdUnitI18nKey 应存在", () => {
      const list = service.getEventList();
      const item = list.find((e) => e.value === NotificationEvent.MONTHLY_PASS_QUOTA_LOW);
      expect(item?.thresholdUnitI18nKey).toBe("notificationEventThresholdUnit.monthly_pass_quota_low");
    });

    it("非阈值事件 thresholdUnitI18nKey 应为 undefined", () => {
      const list = service.getEventList();
      const item = list.find((e) => e.value === NotificationEvent.ABNORMAL_LOGIN);
      expect(item?.thresholdUnitI18nKey).toBeUndefined();
    });

    it("每个事件应有 labelI18nKey 字符串", () => {
      const list = service.getEventList();
      for (const item of list) {
        expect(typeof item.labelI18nKey).toBe("string");
        expect(item.labelI18nKey.length).toBeGreaterThan(0);
      }
    });
  });
});

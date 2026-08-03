import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationController } from "../../../src/api/controllers/v1/notification/notification.controller";
import { NotificationManagementService } from "../../../src/services/notification/notification-management.service";
import { NotificationEvent } from "../../../src/constant/notification-event";
import { NotFoundError } from "../../../src/util/errors";
import type { TypedRequest } from "../../../src/types/express";

vi.mock("../../../src/services/notification/notification-management.service");

// Mock PermissionService to grant NOTIFICATION_MANAGE
vi.mock("../../../src/services/users/permission.service", () => ({
  PermissionService: {
    getInstance: () => ({
      checkUserPermissions: vi.fn().mockResolvedValue({
        hasPermission: true,
        missingPermissions: [],
        checkedPermissions: ["notification:manage"],
      }),
      hasPermission: vi.fn().mockResolvedValue(true),
      getUserFullPermissions: vi.fn().mockResolvedValue({
        effectivePermissions: ["notification:manage"],
      }),
    }),
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

const serviceMock = {
  getPreference: vi.fn(),
  updatePreference: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  getLogs: vi.fn(),
  getEventList: vi.fn(),
};

const makeRequest = (userId = "user-1"): TypedRequest =>
  ({
    user: { userId },
    headers: { "x-request-id": "req-test", "user-agent": "vitest" },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as TypedRequest;

const prefDto = {
  id: "pref-1",
  notificationEmail: "user@example.com",
  subscribedEvents: [NotificationEvent.BALANCE_LOW],
  thresholds: {},
  cooldownMinutes: 60,
  createTime: "2026-01-01T00:00:00.000Z",
  updateTime: "2026-01-01T00:00:00.000Z",
};

const webhookDto = {
  id: "wh-1",
  name: "My Hook",
  url: "https://example.com/hook",
  format: "generic",
  hasSecret: false,
  enabled: true,
  createTime: "2026-01-01T00:00:00.000Z",
  updateTime: "2026-01-01T00:00:00.000Z",
};

describe("NotificationController", () => {
  let controller: NotificationController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(NotificationManagementService, "getInstance").mockReturnValue(
      serviceMock as unknown as NotificationManagementService,
    );
    controller = new NotificationController();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /notification/preferences ─────────────────────────────────────────

  describe("getPreferences()", () => {
    it("应调用 service.getPreference 并返回结果", async () => {
      serviceMock.getPreference.mockResolvedValue(prefDto);

      const result = await controller.getPreferences(makeRequest());

      expect(serviceMock.getPreference).toHaveBeenCalledWith("user-1");
      expect(result).toEqual(prefDto);
    });

    it("不同 userId 应传入正确的 userId", async () => {
      serviceMock.getPreference.mockResolvedValue(prefDto);

      await controller.getPreferences(makeRequest("user-99"));

      expect(serviceMock.getPreference).toHaveBeenCalledWith("user-99");
    });
  });

  // ─── PUT /notification/preferences ─────────────────────────────────────────

  describe("updatePreferences()", () => {
    it("应调用 service.updatePreference 并返回更新后的 DTO", async () => {
      const updated = { ...prefDto, cooldownMinutes: 30 };
      serviceMock.updatePreference.mockResolvedValue(updated);
      const req = makeRequest();

      const result = await controller.updatePreferences({ cooldownMinutes: 30 }, req);

      expect(serviceMock.updatePreference).toHaveBeenCalledWith("user-1", { cooldownMinutes: 30 }, req);
      expect(result.cooldownMinutes).toBe(30);
    });

    it("空 body 时应仍然调用 service", async () => {
      serviceMock.updatePreference.mockResolvedValue(prefDto);

      await controller.updatePreferences({}, makeRequest());

      expect(serviceMock.updatePreference).toHaveBeenCalledTimes(1);
    });
  });

  // ─── GET /notification/webhooks ─────────────────────────────────────────────

  describe("listWebhooks()", () => {
    it("应返回 webhook 数组", async () => {
      serviceMock.listWebhooks.mockResolvedValue([webhookDto]);

      const result = await controller.listWebhooks(makeRequest());

      expect(serviceMock.listWebhooks).toHaveBeenCalledWith("user-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("wh-1");
    });

    it("无 webhook 时应返回空数组", async () => {
      serviceMock.listWebhooks.mockResolvedValue([]);

      const result = await controller.listWebhooks(makeRequest());
      expect(result).toEqual([]);
    });
  });

  // ─── POST /notification/webhooks ────────────────────────────────────────────

  describe("createWebhook()", () => {
    it("应调用 service.createWebhook 并返回新 webhook DTO", async () => {
      serviceMock.createWebhook.mockResolvedValue(webhookDto);
      const req = makeRequest();
      const body = { name: "My Hook", url: "https://example.com/hook", format: "generic" };

      const result = await controller.createWebhook(body, req);

      expect(serviceMock.createWebhook).toHaveBeenCalledWith("user-1", body, req);
      expect(result.id).toBe("wh-1");
    });
  });

  // ─── PUT /notification/webhooks/{id} ────────────────────────────────────────

  describe("updateWebhook()", () => {
    it("应调用 service.updateWebhook 并返回更新后的 DTO", async () => {
      const updated = { ...webhookDto, name: "Updated" };
      serviceMock.updateWebhook.mockResolvedValue(updated);
      const req = makeRequest();

      const result = await controller.updateWebhook("wh-1", { name: "Updated" }, req);

      expect(serviceMock.updateWebhook).toHaveBeenCalledWith("wh-1", "user-1", { name: "Updated" }, req);
      expect(result.name).toBe("Updated");
    });

    it("webhook 不存在时应向上传播 NotFoundError", async () => {
      serviceMock.updateWebhook.mockRejectedValue(new NotFoundError("Webhook not found"));

      await expect(controller.updateWebhook("wh-999", { name: "X" }, makeRequest())).rejects.toThrow(NotFoundError);
    });
  });

  // ─── DELETE /notification/webhooks/{id} ─────────────────────────────────────

  describe("deleteWebhook()", () => {
    it("应调用 service.deleteWebhook 并返回 { success: true }", async () => {
      serviceMock.deleteWebhook.mockResolvedValue(undefined);
      const req = makeRequest();

      const result = await controller.deleteWebhook("wh-1", req);

      expect(serviceMock.deleteWebhook).toHaveBeenCalledWith("wh-1", "user-1", req);
      expect(result).toEqual({ success: true });
    });

    it("webhook 不存在时应向上传播 NotFoundError", async () => {
      serviceMock.deleteWebhook.mockRejectedValue(new NotFoundError("Webhook not found"));

      await expect(controller.deleteWebhook("wh-999", makeRequest())).rejects.toThrow(NotFoundError);
    });
  });

  // ─── POST /notification/webhooks/{id}/test ──────────────────────────────────

  describe("testWebhook()", () => {
    it("测试成功时应返回 { success: true }", async () => {
      serviceMock.testWebhook.mockResolvedValue({ success: true });

      const result = await controller.testWebhook("wh-1", makeRequest());

      expect(serviceMock.testWebhook).toHaveBeenCalledWith("wh-1", "user-1");
      expect(result.success).toBe(true);
    });

    it("测试失败时应返回 { success: false, error: message }", async () => {
      serviceMock.testWebhook.mockResolvedValue({ success: false, error: "Connection refused" });

      const result = await controller.testWebhook("wh-1", makeRequest());

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("webhook 不存在时应向上传播 NotFoundError", async () => {
      serviceMock.testWebhook.mockRejectedValue(new NotFoundError("Webhook not found"));

      await expect(controller.testWebhook("wh-999", makeRequest())).rejects.toThrow(NotFoundError);
    });
  });

  // ─── GET /notification/logs ─────────────────────────────────────────────────

  describe("getLogs()", () => {
    it("应调用 service.getLogs 并传入 page/pageSize", async () => {
      const logsDto = { logs: [], total: 0, page: 2, pageSize: 10 };
      serviceMock.getLogs.mockResolvedValue(logsDto);

      const result = await controller.getLogs(2, 10, makeRequest());

      expect(serviceMock.getLogs).toHaveBeenCalledWith("user-1", 2, 10);
      expect(result).toEqual(logsDto);
    });

    it("默认参数 page=1, pageSize=20 时应正确传入", async () => {
      serviceMock.getLogs.mockResolvedValue({ logs: [], total: 0, page: 1, pageSize: 20 });

      await controller.getLogs(1, 20, makeRequest());

      expect(serviceMock.getLogs).toHaveBeenCalledWith("user-1", 1, 20);
    });
  });

  // ─── GET /notification/events ───────────────────────────────────────────────

  describe("getEventList()", () => {
    it("应返回事件列表", async () => {
      const events = [
        { value: NotificationEvent.BALANCE_LOW, label: "余额不足", hasThreshold: true, thresholdUnit: "元" },
        { value: NotificationEvent.ABNORMAL_LOGIN, label: "异常登录", hasThreshold: false },
      ];
      serviceMock.getEventList.mockReturnValue(events);

      const result = await controller.getEventList();

      expect(serviceMock.getEventList).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(NotificationEvent.BALANCE_LOW);
    });
  });
});

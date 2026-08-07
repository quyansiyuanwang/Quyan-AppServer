import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "../../../src/services/notification/notification.service";
import { NotificationPreferenceRepository } from "../../../src/store/notification/notification-preference.repository";
import { ConfigService } from "../../../src/services/system/config.service";
import { RedisService } from "../../../src/services/infrastructure/redis.service";
import { NotificationPreferenceInitializerService } from "../../../src/services/notification/notification-preference-initializer.service";
import { NotificationEvent } from "../../../src/constant/notification-event";

vi.mock("../../../src/store/notification/notification-preference.repository");
vi.mock("../../../src/services/system/config.service");
vi.mock("../../../src/services/infrastructure/redis.service");
vi.mock("../../../src/services/notification/notification-preference-initializer.service");
vi.mock("nodemailer");
vi.mock("axios");

const repoMock = {
  findByUserId: vi.fn(),
  findWebhooksByUserId: vi.fn(),
  createLog: vi.fn(),
  createInboxItem: vi.fn(),
};

const configMock = {
  getSmtpConfig: vi.fn(),
  getSiteConfig: vi.fn(),
};

const redisMock = {
  setIfNotExists: vi.fn(),
};

const initializerMock = {
  getOrInitialize: vi.fn(),
};

const makeWebhook = (overrides: Record<string, unknown> = {}) => ({
  id: "wh-1",
  name: "Test Hook",
  url: "https://example.com/hook",
  format: "generic",
  secret: null,
  enabled: true,
  ...overrides,
});

const makePreference = (overrides: Record<string, unknown> = {}) => ({
  id: "pref-1",
  userId: "user-1",
  notificationEmail: "user@example.com",
  subscribedEvents: [NotificationEvent.BALANCE_LOW],
  thresholds: {},
  cooldownMinutes: 60,
  createTime: new Date(),
  updateTime: new Date(),
  ...overrides,
});

const payload = {
  currentBalance: "5.00",
  threshold: "10.00",
};

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(NotificationPreferenceRepository, "getInstance").mockReturnValue(
      repoMock as unknown as NotificationPreferenceRepository,
    );
    vi.spyOn(ConfigService, "getInstance").mockReturnValue(configMock as unknown as ConfigService);
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as unknown as RedisService);
    vi.spyOn(NotificationPreferenceInitializerService, "getInstance").mockReturnValue(
      initializerMock as unknown as NotificationPreferenceInitializerService,
    );
    (NotificationService as any).instance = undefined;
    service = new (NotificationService as any)(repoMock, configMock, redisMock, initializerMock);

    repoMock.createLog.mockResolvedValue({});
    redisMock.setIfNotExists.mockResolvedValue(true);
    repoMock.createInboxItem.mockResolvedValue({});
    configMock.getSiteConfig.mockResolvedValue({ backendPublicUrl: "" });
  });

  describe("dispatch() — fire-and-forget 安全性", () => {
    it("首次初始化后未订阅时应静默返回，不抛出", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(
        makePreference({ subscribedEvents: [NotificationEvent.ABNORMAL_LOGIN] }),
      );
      await expect(service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload)).resolves.toBeUndefined();
    });

    it("事件未订阅时应静默返回", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(
        makePreference({ subscribedEvents: [NotificationEvent.ABNORMAL_LOGIN] }),
      );
      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);
      expect(redisMock.setIfNotExists).not.toHaveBeenCalled();
    });

    it("内部抛出未知异常时 dispatch 不应向外抛出", async () => {
      initializerMock.getOrInitialize.mockRejectedValue(new Error("DB crash"));
      await expect(service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload)).resolves.toBeUndefined();
    });
  });

  describe("冷却时间 (cooldown)", () => {
    it("冷却期内 setIfNotExists 返回 false 时不应发送通知", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference());
      redisMock.setIfNotExists.mockResolvedValue(false);
      repoMock.findWebhooksByUserId.mockResolvedValue([]);

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(repoMock.findWebhooksByUserId).not.toHaveBeenCalled();
    });

    it("冷却 key 格式应为 notify:cooldown:{userId}:{event}", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference());
      redisMock.setIfNotExists.mockResolvedValue(true);
      repoMock.findWebhooksByUserId.mockResolvedValue([]);
      configMock.getSmtpConfig.mockResolvedValue({ host: "" });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(redisMock.setIfNotExists).toHaveBeenCalledWith(
        "notify:cooldown:user-1:balance_low",
        "1",
        expect.any(Number),
      );
    });

    it("cooldownMinutes 应正确转换为毫秒 TTL", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ cooldownMinutes: 30 }));
      redisMock.setIfNotExists.mockResolvedValue(true);
      repoMock.findWebhooksByUserId.mockResolvedValue([]);
      configMock.getSmtpConfig.mockResolvedValue({ host: "" });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      const [, , ttlMs] = redisMock.setIfNotExists.mock.calls[0];
      expect(ttlMs).toBe(30 * 60 * 1000);
    });

    it("Redis 不可用时应跳过冷却检查并继续发送", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ notificationEmail: null }));
      redisMock.setIfNotExists.mockRejectedValue(new Error("Redis down"));
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook()]);

      // webhook 发送会失败（axios 未 mock），但不应因 Redis 失败而中断
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockRejectedValue(new Error("Network error"));

      await expect(service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload)).resolves.toBeUndefined();
      expect(repoMock.findWebhooksByUserId).toHaveBeenCalled();
    });
  });

  describe("邮件投递", () => {
    beforeEach(() => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference());
      repoMock.findWebhooksByUserId.mockResolvedValue([]);
    });

    it("SMTP 未配置时应记录 failed 日志", async () => {
      configMock.getSmtpConfig.mockResolvedValue({ host: "" });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(repoMock.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "email",
          deliveryStatus: "failed",
          errorMessage: expect.stringContaining("SMTP"),
        }),
      );
    });

    it("SMTP 配置存在时应尝试发送邮件并记录 success 日志", async () => {
      configMock.getSmtpConfig.mockResolvedValue({
        host: "smtp.example.com",
        port: 465,
        secure: true,
        user: "noreply@example.com",
        password: "secret",
      });

      const nodemailer = await import("nodemailer");
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-id" });
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: sendMailMock,
      } as any);

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          subject: "余额不足提醒",
          text: expect.stringContaining("当前余额: 5.00"),
        }),
      );
      expect(repoMock.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email", deliveryStatus: "success" }),
      );
    });

    it("notificationEmail 为 null 时不应发送邮件", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ notificationEmail: null }));

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(configMock.getSmtpConfig).not.toHaveBeenCalled();
    });
  });

  describe("Webhook 投递", () => {
    beforeEach(() => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ notificationEmail: null }));
    });

    it("disabled webhook 不应被调用", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook({ enabled: false })]);

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      const axiosMod = await import("axios");
      expect(axiosMod.default.post).not.toHaveBeenCalled();
    });

    it("webhook 发送成功时应记录 success 日志", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook()]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(repoMock.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "webhook",
          webhookId: "wh-1",
          deliveryStatus: "success",
        }),
      );
    });

    it("webhook 发送失败时应记录 failed 日志，不抛出", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook()]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockRejectedValue(new Error("Connection refused"));

      await expect(service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload)).resolves.toBeUndefined();

      expect(repoMock.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "webhook",
          deliveryStatus: "failed",
          errorMessage: expect.stringContaining("Connection refused"),
        }),
      );
    });

    it("有 secret 时应在请求头中附加 HMAC 签名", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook({ secret: "my-secret" })]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      const [, , options] = vi.mocked(axiosMod.default.post).mock.calls[0];
      const headers = (options as any).headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("无 secret 时不应附加签名头", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook({ secret: null })]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      const [, , options] = vi.mocked(axiosMod.default.post).mock.calls[0];
      const headers = (options as any).headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toBeUndefined();
    });

    it("多个 enabled webhook 应并发发送", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([
        makeWebhook({ id: "wh-1", url: "https://a.com/hook" }),
        makeWebhook({ id: "wh-2", url: "https://b.com/hook" }),
      ]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(axiosMod.default.post).toHaveBeenCalledTimes(2);
      expect(repoMock.createLog).toHaveBeenCalledTimes(2);
    });

    it("一个 webhook 失败不应阻止其他 webhook 发送", async () => {
      repoMock.findWebhooksByUserId.mockResolvedValue([
        makeWebhook({ id: "wh-1", url: "https://fail.com/hook" }),
        makeWebhook({ id: "wh-2", url: "https://ok.com/hook" }),
      ]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post)
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(repoMock.createLog).toHaveBeenCalledTimes(2);
      const calls = repoMock.createLog.mock.calls.map((c: any) => c[0].deliveryStatus);
      expect(calls).toContain("failed");
      expect(calls).toContain("success");
    });
  });

  describe("日志记录", () => {
    it("createLog 失败时不应影响整体流程", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ notificationEmail: null }));
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook()]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });
      repoMock.createLog.mockRejectedValue(new Error("Log DB error"));

      await expect(service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload)).resolves.toBeUndefined();
    });

    it("日志应包含 userId、eventType、title、content", async () => {
      initializerMock.getOrInitialize.mockResolvedValue(makePreference({ notificationEmail: null }));
      repoMock.findWebhooksByUserId.mockResolvedValue([makeWebhook()]);
      const axiosMod = await import("axios");
      vi.mocked(axiosMod.default.post).mockResolvedValue({ status: 200 });

      await service.dispatch("user-1", NotificationEvent.BALANCE_LOW, payload);

      expect(repoMock.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          eventType: NotificationEvent.BALANCE_LOW,
          title: "余额不足提醒",
          content: "当前余额已低于设定阈值，请及时充值。",
        }),
      );
    });
  });
});
